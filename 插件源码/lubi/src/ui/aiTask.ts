import { App, Modal, Notice, requestUrl } from "obsidian";
import type LubiPlugin from "../main";
import { Task } from "../core/tasks";
import { todayStr } from "../core/time";
import { button, icon } from "./components";
import { TaskModal } from "./modals";
import { curlJson, validateAiUrl } from "../services/curl";
import { aiKey } from "../services/secrets";

type AiSubtask = Partial<Pick<Task, "title" | "date" | "start" | "estimate" | "location">>;
type AiDraft = Partial<Pick<Task, "title" | "category" | "date" | "start" | "estimate" | "startDate" | "endDate" | "location">> & {
  subtasks?: AiSubtask[];
  confidence?: "high" | "medium" | "low";
  explanation?: string;
};

function cleanJson(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

function chatEndpoint(endpoint: string): string {
  validateAiUrl(endpoint);
  const value = endpoint.trim().replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(value)) return value;
  return `${value}/chat/completions`;
}

function validDraft(value: unknown): AiDraft {
  if (!value || typeof value !== "object") throw new Error("AI 返回的不是任务对象");
  const x = value as Record<string, unknown>;
  const title = typeof x.title === "string" ? x.title.trim() : "";
  if (!title) throw new Error("AI 没有识别出任务名称，请补充具体目标");
  const out: AiDraft = { title };
  for (const key of ["category", "date", "start", "startDate", "endDate"] as const) {
    if (typeof x[key] === "string" && x[key]) out[key] = x[key];
  }
  if (x.location !== undefined && (typeof x.location !== "string" || x.location.length > 200)) throw new Error("AI 返回的地点必须是不超过 200 字符的文字");
  if (typeof x.location === "string") out.location = x.location.trim();
  if (typeof x.estimate === "number" && Number.isFinite(x.estimate) && x.estimate > 0) out.estimate = Math.round(x.estimate);
  if (x.confidence === "high" || x.confidence === "medium" || x.confidence === "low") out.confidence = x.confidence;
  if (typeof x.explanation === "string") out.explanation = x.explanation;
  if (Array.isArray(x.subtasks)) {
    out.subtasks = x.subtasks.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const child = item as Record<string, unknown>;
      const childTitle = typeof child.title === "string" ? child.title.trim() : "";
      if (!childTitle) return [];
      if (child.location !== undefined && (typeof child.location !== "string" || child.location.length > 200)) throw new Error("AI 返回的子任务地点必须是不超过 200 字符的文字");
      const result: AiSubtask = { title: childTitle, location: typeof child.location === "string" ? child.location.trim() : "" };
      for (const key of ["date", "start"] as const) if (typeof child[key] === "string" && child[key]) result[key] = child[key];
      if (typeof child.estimate === "number" && Number.isFinite(child.estimate) && child.estimate > 0) result.estimate = Math.round(child.estimate);
      return [result];
    });
  }
  return out;
}

export class AiTaskModal extends Modal {
  private input!: HTMLTextAreaElement;
  private result!: HTMLElement;
  private parseButton!: HTMLButtonElement;
  private draft: AiDraft | null = null;

  constructor(app: App, private plugin: LubiPlugin, private date = todayStr(), private onSaved?: () => void) { super(app); }

  onOpen(): void {
    this.modalEl.addClass("lubi-modal", "lubi-ai-task-modal");
    this.titleEl.setText("AI 创建任务");
    const intro = this.contentEl.createDiv({ cls: "lubi-ai-task-intro" });
    icon(intro, "sparkles", "lubi-icon");
    intro.createSpan({ text: "用一句话描述任务，AI 只生成草稿，不会直接写入。" });
    this.input = this.contentEl.createEl("textarea", { attr: { rows: "4", placeholder: "例如：下周三下午完成插件首页优化，预计两小时", "aria-label": "任务描述" } });
    const actions = this.contentEl.createDiv({ cls: "lubi-modal-actions" });
    button(actions, "取消", () => this.close(), { cls: "lubi-btn-ghost" });
    this.parseButton = button(actions, "AI 解析", () => void this.parse(), { primary: true });
    this.result = this.contentEl.createDiv({ cls: "lubi-ai-task-result" });
    this.contentEl.onkeydown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); void this.parse(); }
    };
    window.setTimeout(() => this.input.focus(), 20);
  }

  private async parse(): Promise<void> {
    const prompt = this.input.value.trim();
    if (!prompt) { new Notice("先描述一下要做什么"); this.input.focus(); return; }
    const s = this.plugin.settings;
    if (!s.aiEndpoint.trim() || !s.aiModel.trim()) { new Notice("请先在设置中填写 AI 接口地址和模型", 5000); return; }
    this.parseButton.disabled = true;
    this.parseButton.setText("解析中…");
    this.result.empty();
    try {
      const categories = s.categories.filter((c) => c.kind === "time").map((c) => c.name);
      const system = `你是 Lubi 的任务解析器。当前日期是 ${todayStr()}。只返回 JSON，不要 Markdown，不要解释。字段必须是：title（字符串）、location（可选地点字符串，最多 200 字符）、category（从 ${JSON.stringify(categories)} 中选一个）、date（YYYY-MM-DD 或空字符串）、start（HH:MM 或空字符串）、estimate（分钟数字或 0）、startDate（YYYY-MM-DD 或空字符串）、endDate（YYYY-MM-DD 或空字符串）、confidence（high/medium/low）、explanation（简短中文）、subtasks（子任务数组，每项包含 title、date、start、estimate、location；没有子任务时返回空数组）。用户明确说有多个步骤时，拆成 subtasks 供逐项确认；应用将其保存为独立任务，可继承所选项目，不创建父子关系。只在用户明确提供时填写日期、时间、时长、截止日期和地点；地点未提及时留空，不猜测、不从主任务继承到后续任务；子任务未明确的日期和分类由应用继承父任务，未明确的时长留空或 0。`;
      const body = JSON.stringify({ model: s.aiModel, temperature: 0.1, messages: [{ role: "system", content: system }, { role: "user", content: prompt }] });
      const key = aiKey(this.plugin.app, s);
      let response: { status: number; json: unknown };
      try {
        const native = await requestUrl({ url: chatEndpoint(s.aiEndpoint), method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body, throw: false });
        response = { status: native.status, json: native.json };
      } catch {
        response = await curlJson(chatEndpoint(s.aiEndpoint), { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body });
      }
      if (response.status < 200 || response.status >= 300) throw new Error(`AI 请求失败（${response.status}）`);
      const data = response.json as { choices?: { message?: { content?: string } }[] };
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error("AI 没有返回内容");
      this.draft = validDraft(JSON.parse(cleanJson(content)));
      this.renderResult();
    } catch (e) {
      this.result.createDiv({ cls: "lubi-ai-task-error", text: `解析失败：${(e as Error).message}` });
    } finally {
      this.parseButton.disabled = false;
      this.parseButton.setText("AI 解析");
    }
  }

  private renderResult(): void {
    if (!this.draft) return;
    const d = this.draft;
    this.result.empty();
    const head = this.result.createDiv({ cls: "lubi-ai-task-result-head" });
    head.createSpan({ text: "AI 识别结果" });
    head.createSpan({ cls: "lubi-muted", text: d.confidence === "low" ? "建议仔细确认" : "请确认后创建" });
    const rows: [string, string][] = [["任务", d.title || "未识别"], ["分类", d.category || "未指定"], ["地点", d.location || "未指定"], ["日期", d.date || "未安排"], ["开始", d.start || "未指定"], ["预计时长", d.estimate ? `${d.estimate} 分钟` : "未指定"], ["截止", d.endDate || "未指定"]];
    const grid = this.result.createDiv({ cls: "lubi-ai-task-grid" });
    for (const [label, value] of rows) { const row = grid.createDiv({ cls: "lubi-ai-task-row" }); row.createSpan({ cls: "lubi-muted", text: label }); row.createSpan({ text: value }); }
    if (d.subtasks?.length) {
      this.result.createDiv({ cls: "lubi-ai-task-subtasks-title", text: `后续任务（${d.subtasks.length}）` });
      const list = this.result.createDiv({ cls: "lubi-ai-task-subtasks" });
      d.subtasks.forEach((child, i) => list.createDiv({ text: `${i + 1}. ${child.title}${child.estimate ? `（${child.estimate} 分钟）` : ""}` }));
    }
    if (d.explanation) this.result.createDiv({ cls: "lubi-ai-task-explanation", text: d.explanation });
    const actions = this.result.createDiv({ cls: "lubi-modal-actions" });
    button(actions, "重新描述", () => { this.input.focus(); }, { cls: "lubi-btn-ghost" });
    button(actions, "使用这些信息创建任务", () => this.confirm(), { primary: true });
  }

  private confirm(): void {
    if (!this.draft) return;
    const fallback = this.plugin.settings.categories.find((c) => c.kind === "time")?.name || "";
    const defaults: Partial<Task> = { title: this.draft.title, location: this.draft.location || "", category: this.draft.category || fallback, date: this.draft.date || "", start: this.draft.start || "", estimate: this.draft.estimate || 0, startDate: this.draft.startDate || "", endDate: this.draft.endDate || "" };
    this.close();
    new TaskModal(this.app, this.plugin, { defaults, onSaved: (parent) => this.openSubtasks(parent) }).open();
  }

  private openSubtasks(parent: Task): void {
    const children = this.draft?.subtasks || [];
    if (!children.length) { this.onSaved?.(); return; }
    let index = 0;
    const next = () => {
      const child = children[index++];
      if (!child) { this.onSaved?.(); return; }
      const defaults: Partial<Task> = {
        title: child.title,
        location: child.location || "",
        project: parent.project,
        category: parent.category,
        date: child.date || parent.date,
        start: child.start || "",
        estimate: child.estimate || 0,
      };
      new TaskModal(this.app, this.plugin, { defaults, onSaved: next }).open();
    };
    next();
  }
}
