import { App, Notice, PluginSettingTab, requestUrl, SecretComponent, Setting } from "obsidian";
import type LubiPlugin from "../main";
import { CategoryDef, DEFAULT_CATEGORIES } from "../settings";
import { accentConflicts, parseColor, resolveDefault, RGB } from "../core/color";
import { ConfirmModal } from "./modals";
import { curlJson, validateAiUrl } from "../services/curl";
import { aiKey } from "../services/secrets";
import { iconButton, tip } from "./components";
import { taskImportPrompt } from "../core/taskImport";
import { modelPicker } from "./modelPicker";
import { PluginUpdateState, renderPluginUpdate } from "./pluginUpdateSettings";

let settingsLabelId = 0;

const COLORS = [
  ["蓝", "var(--color-blue)"],
  ["绿", "var(--color-green)"],
  ["紫", "var(--color-purple)"],
  ["橙", "var(--color-orange)"],
  ["黄", "var(--color-yellow)"],
  ["红", "var(--color-red)"],
  ["粉", "var(--color-pink)"],
  ["青", "var(--color-cyan)"],
  ["灰", "var(--color-base-60)"],
  ["石板", "#6b7a99"],
  ["暖棕", "#a0856b"],
];

/** 在真实主题下解析颜色（变量 → rgb）；无 DOM 时退回默认表 */
function resolveLive(value: string): RGB | null {
  if (typeof document === "undefined" || typeof getComputedStyle === "undefined") return resolveDefault(value);
  const probe = document.body.createDiv();
  probe.style.color = value;
  probe.style.display = "none";
  const rgb = parseColor(getComputedStyle(probe).color || "") || resolveDefault(value);
  probe.remove();
  return rgb;
}

export class LubiSettingTab extends PluginSettingTab {
  private readonly updateState: PluginUpdateState = { busy: false, confirming: false, status: "" };

  constructor(app: App, private plugin: LubiPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("lubi-settings");
    const s = this.plugin.settings;
    const save = () => void this.plugin.saveSettings();
    const section = (title: string) => {
      const host = containerEl.createDiv({ cls: "lubi-settings-section" });
      host.createEl("h3", { text: title });
      return host;
    };
    const field = (parent: HTMLElement, control: HTMLElement, label: string, column: string) => {
      const wrap = parent.createEl(control.matches("input, select, textarea") ? "label" : "div", { cls: "lubi-settings-field", attr: { "data-category-field": column } });
      const caption = wrap.createSpan({ cls: "lubi-settings-field-label", text: label, attr: { id: `lubi-setting-label-${++settingsLabelId}` } });
      wrap.appendChild(control);
      if (control.tagName !== "BUTTON") { control.removeAttribute("aria-label"); control.setAttribute("aria-labelledby", caption.id); }
    };

    renderPluginUpdate(section("插件更新"), this.app, this.plugin.manifest, this.updateState);

    const basics = section("数据与日程");
    new Setting(basics).setName("日记文件夹").setDesc("每天一份日记，记录写入「记录」章节").addText((t) => {
      t.inputEl.setAttribute("aria-label", "日记文件夹");
      return t.setValue(s.journalFolder).onChange((v) => { s.journalFolder = v.trim() || "日记"; save(); });
    });
    new Setting(basics).setName("任务数据文件").addText((t) => {
      t.inputEl.setAttribute("aria-label", "任务数据文件");
      return t.setValue(s.taskFile).onChange((v) => { s.taskFile = v.trim() || "任务/任务数据.json"; save(); });
    });
    new Setting(basics).setName("备份文件夹").setDesc("旧数据迁移前的备份位置").addText((t) => {
      t.inputEl.setAttribute("aria-label", "备份文件夹");
      return t.setValue(s.backupFolder).onChange((v) => { s.backupFolder = v.trim() || "备份"; save(); });
    });
    // Planning calendars always show the full day; retain legacy hour fields only in saved data.
    new Setting(basics).setName("完成与时间记录").setDesc("标记完成只修改任务状态；记录实际和按计划补记由你明确选择。旧自动记录设置不再触发写入或删除。");
    new Setting(basics).setName("每日可用小时").setDesc("用于计划负载计算，不代表实际投入").addText((t) => {
      t.inputEl.setAttribute("aria-label", "每日可用小时");
      return t.setPlaceholder("8").setValue(String(s.dailyCapacityHours ?? 8)).onChange((v) => { s.dailyCapacityHours = clamp(Number(v), 1, 24, 8); save(); });
    });

    const categories = section("分类");
    categories.createEl("p", { cls: "lubi-settings-note", text: "时间类记时长，金钱类记金额。背景时间用于睡眠等低强调分类。" });
    const warn = categories.createDiv({ cls: "lubi-settings-warn" });
    const list = categories.createDiv({ cls: "lubi-cat-settings" });
    const checkAccent = () => {
      warn.empty();
      const hits = accentConflicts(s.categories, "var(--interactive-accent)", resolveLive);
      warn.toggleClass("is-on", hits.length > 0);
      if (hits.length) warn.setText(`「${hits.join("、")}」与按钮强调色接近，建议换色，避免混淆数据与操作。`);
    };
    const draw = () => {
      list.empty(); checkAccent();
      const header = list.createDiv({ cls: "lubi-category-header", attr: { "aria-hidden": "true" } });
      for (const title of ["名称", "图标", "颜色", "背景", "类型", "操作"]) header.createSpan({ text: title });
      s.categories.forEach((c, i) => {
        const row = new Setting(list);
        row.settingEl.addClass("lubi-category-row");
        const controls = row.controlEl;
        controls.addClass("lubi-category-controls");
        row.addText((t) => { field(controls, t.inputEl, "名称", "name"); return t.setValue(c.name).onChange((v) => { c.name = v.trim() || c.name; tip(remove, `删除分类：${c.name}`); tip(up, `上移分类：${c.name}`); save(); }); });
        row.addText((t) => { field(controls, t.inputEl, "图标", "icon"); return t.setPlaceholder("图标名").setValue(c.icon).onChange((v) => { c.icon = v.trim() || "tag"; save(); }); });
        row.addDropdown((d) => {
          field(controls, d.selectEl, "颜色", "color");
          for (const [name, value] of COLORS) d.addOption(value, name);
          if (!COLORS.some(([, value]) => value === c.color)) d.addOption(c.color, "自定义");
          d.setValue(c.color).onChange((v) => { c.color = v; save(); checkAccent(); });
        });
        row.addToggle((t) => { field(controls, t.toggleEl, "背景时间", "background"); return t.setValue(!!c.rest).onChange((v) => { c.rest = v || undefined; save(); }); });
        row.addDropdown((d) => { field(controls, d.selectEl, "类型", "kind"); return d.addOption("time", "时间").addOption("money", "金钱").setValue(c.kind).onChange((v) => { c.kind = v as CategoryDef["kind"]; save(); }); });
        const actions = controls.createDiv({ cls: "lubi-category-actions" });
        const up = iconButton(actions, "arrow-up", `上移分类：${c.name}`, () => { [s.categories[i - 1], s.categories[i]] = [s.categories[i], s.categories[i - 1]]; save(); draw(); });
        up.addClass("lubi-category-up");
        up.disabled = i === 0;
        const remove = iconButton(actions, "trash-2", `删除分类：${c.name}`, () => { s.categories.splice(i, 1); save(); draw(); });
        remove.addClass("lubi-category-remove");
      });
      const actions = new Setting(list);
      actions.settingEl.addClass("lubi-settings-actions");
      actions.addButton((b) => b.setButtonText("添加分类").onClick(() => { s.categories.push({ name: "新分类", icon: "tag", color: "var(--color-base-60)", kind: "time" }); save(); draw(); }));
      actions.addButton((b) => b.setButtonText("恢复默认").onClick(() => { s.categories = DEFAULT_CATEGORIES.map((c) => ({ ...c })); save(); draw(); }));
    };
    draw();

    const json = section("JSON 任务导入");
    json.addClass("lubi-settings-json-import");
    const promptValue = () => taskImportPrompt(s.categories.filter(c => c.kind === "time").map(c => c.name));
    const copy = new Setting(json).setName("系统提示词").setDesc("复制给外部 AI，与它讨论后生成含可选地点的导入 JSON；未明确地点时留空。不包含接口、密钥或历史任务。");
    copy.settingEl.addClass("lubi-setting-stacked");
    const prompt = json.createEl("textarea", { cls: "lubi-json-prompt", attr: { readonly: "", "aria-label": "JSON 任务导入系统提示词", spellcheck: "false" } });
    prompt.value = promptValue();
    copy.addButton(b => b.setButtonText("复制系统提示词").onClick(async () => {
      prompt.value = promptValue();
      try {
        if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
        await navigator.clipboard.writeText(prompt.value);new Notice("系统提示词已复制");
      } catch { prompt.focus();prompt.select();new Notice("无法自动复制，已选中提示词，请手动复制"); }
    }));

    const ai = containerEl.createEl("details", { cls: "lubi-settings-section lubi-settings-ai" });
    const summary = ai.createEl("summary");
    summary.createSpan({ text: "AI 任务创建" });
    const summaryModel = summary.createSpan({ cls: "lubi-settings-ai-model" });
    const updateSummary = () => summaryModel.setText(s.aiEndpoint && s.aiModel ? s.aiModel : "未配置");
    updateSummary();
    ai.createEl("p", { cls: "lubi-settings-note", text: "只发送当前输入，草稿确认后才创建任务。测试连接可能发送短请求。支持 Ollama 和 OpenAI 兼容接口。" });
    const endpoint = new Setting(ai).setName("接口地址").setDesc("填写兼容聊天接口地址");
    endpoint.settingEl.addClass("lubi-setting-stacked");
    endpoint.addText((t) => { t.inputEl.setAttribute("aria-label", "AI 接口地址"); t.inputEl.dataset.setting = "ai-endpoint"; return t.setValue(s.aiEndpoint).onChange((v) => { s.aiEndpoint = v.trim(); updateSummary(); save(); }); });
    let modelInput: HTMLInputElement | undefined;
    let choices: ReturnType<typeof modelPicker> | undefined;
    const model = new Setting(ai).setName("模型").setDesc("可手动填写，也可从获取到的模型中选择");
    model.settingEl.addClass("lubi-setting-stacked");
    model.addText((t) => {
      modelInput = t.inputEl; t.inputEl.setAttribute("aria-label", "AI 模型"); t.inputEl.dataset.setting = "ai-model";
      t.setValue(s.aiModel).setPlaceholder("模型名称").onChange((v) => { s.aiModel = v.trim(); updateSummary(); save(); });
      choices = modelPicker(t.inputEl, s.aiModel, value => { s.aiModel = value;updateSummary();save(); });
      return t;
    });
    const key = new Setting(ai).setName("临时 API Key").setDesc("只在本次会话有效，填写后优先于钥匙串中的 Key；本地 Ollama 可留空");
    key.settingEl.addClass("lubi-setting-stacked");
    key.addText((t) => { t.inputEl.type = "password"; t.inputEl.setAttribute("aria-label", "AI API Key"); t.inputEl.dataset.setting = "ai-key"; return t.setValue(s.aiApiKey).onChange((v) => { s.aiApiKey = v.trim(); save(); }); });
    // Obsidian 1.11.4+ keychain: data.json keeps only the secret name; the runtime guard covers test mocks.
    if (this.app.secretStorage && typeof SecretComponent === "function") {
      const keychain = new Setting(ai).setName("钥匙串中的 API Key").setDesc("从 Obsidian 钥匙串选择或新建 Key，重启后无需重新填写；设置文件只保存 Key 的名称");
      keychain.settingEl.addClass("lubi-setting-stacked");
      keychain.settingEl.dataset.setting = "ai-keychain";
      new SecretComponent(this.app, keychain.controlEl).setValue(s.aiKeySecret).onChange((v) => { s.aiKeySecret = v ?? ""; save(); });
    }
    const aiActions = new Setting(ai);
    aiActions.settingEl.addClass("lubi-settings-actions");
    let fetchingModels = false;
    aiActions.addButton((b) => b.setButtonText("获取模型列表").onClick(async () => {
      if (fetchingModels) return;
      fetchingModels = true;b.setDisabled(true);
      const requested = { aiEndpoint: s.aiEndpoint, aiApiKey: aiKey(this.app, s) };
      const current = () => !!modelInput?.isConnected && s.aiEndpoint === requested.aiEndpoint && aiKey(this.app, s) === requested.aiApiKey;
      try { await loadAiModels(requested, names => choices?.setModels(names), current); }
      finally { fetchingModels = false;b.setDisabled(false); }
    }));
    aiActions.addButton((b) => b.setButtonText("测试连接").onClick(() => void testAiConnection({ ...s, aiApiKey: aiKey(this.app, s) })));
    ai.createEl("p", { cls: "lubi-settings-note", text: "临时 Key 不写入设置文件；钥匙串中的 Key 由 Obsidian 保管，设置文件只记名称。旧版明文 Key 在下次保存设置时移除；历史备份／同步副本需自行清理。远程接口必须 HTTPS，证书异常将拒绝连接。" });

    const expenses = section("支出类别");
    new Setting(expenses).setName("类别列表").setDesc("逗号分隔").addTextArea((t) => { t.inputEl.setAttribute("aria-label", "支出类别"); return t.setValue(s.expenseTypes.join(", ")).onChange((v) => { s.expenseTypes = v.split(/[,，]/).map((x) => x.trim()).filter(Boolean); if (!s.expenseTypes.length) s.expenseTypes = ["其他"]; save(); }); });

    const maintenance = section("数据维护");
    maintenance.addClass("lubi-settings-maintenance");
    maintenance.createEl("p", { cls: "lubi-settings-note", text: "迁移前会自动备份，请确认备份文件夹。" });
    new Setting(maintenance).setName("迁移旧版数据").setDesc("转换旧日记与 v13 任务数据，已转换的文件会跳过").addButton((b) => {
      b.buttonEl.addClass("lubi-settings-maintenance-button");
      return b.setButtonText("检查并迁移").onClick(() => new ConfirmModal(this.app, "迁移旧数据？", "会先备份，再改写日记文件与任务数据。", () => void this.plugin.runMigration(true), "开始迁移", false).open());
    });
    new Setting(maintenance).setName("旧父任务转为项目").setDesc("先备份任务文件；保留任务 ID 和历史记录，纯分组父项只作存档，不再计入任务。不会自动迁移。").addButton(b => b.setButtonText("转换为项目").onClick(() => new ConfirmModal(this.app, "转换旧父任务？", "旧顶层父任务成为项目，层级展平；有实际记录、计划时间或预计用时的父项仍保留为任务。备份保存在配置的备份文件夹。", () => {
      void (async () => {
        try { const ids = new Set<string>();for (const date of this.plugin.journal.dates()) for (const row of await this.plugin.journal.read(date, true)) if (row.rec.task) ids.add(row.rec.task);const count = await this.plugin.tasks.convertParentsToProjects(ids);new Notice(`已转换 ${count} 个项目，原任务与记录保留`);this.plugin.refreshViews();this.display(); }
        catch (e) { new Notice(`转换失败：${(e as Error).message}，原数据未改动`); }
      })();
    }, "备份并转换", false).open()));
    new Setting(maintenance).setName("重新显示入门提示").addButton((b) => b.setButtonText("显示").onClick(() => { s.onboardingDone = false; save(); new Notice("没有历史记录时，计划的日历日视图会显示简短入门提示"); }));
  }

}

function modelsEndpoint(endpoint: string): string {
  validateAiUrl(endpoint);
  const value = endpoint.trim().replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(value)) return value.replace(/\/chat\/completions$/i, "/models");
  if (/\/generate$|\/api\/chat$/i.test(value)) return value.replace(/\/(?:generate|api\/chat)$/i, "/api/tags");
  return `${value}/models`;
}

async function fetchAiModels(settings: { aiEndpoint: string; aiApiKey: string }): Promise<string[]> {
  let response: { status: number; json: unknown };
  try {
    response = await curlJson(modelsEndpoint(settings.aiEndpoint), { maxTime: 15, headers: { Accept: "application/json", ...(settings.aiApiKey ? { Authorization: `Bearer ${settings.aiApiKey}` } : {}) } });
  } catch {
    const native = await requestUrl({ url: modelsEndpoint(settings.aiEndpoint), headers: { Accept: "application/json", ...(settings.aiApiKey ? { Authorization: `Bearer ${settings.aiApiKey}` } : {}) }, throw: false });
    response = { status: native.status, json: native.json };
  }
  if (response.status < 200 || response.status >= 300) throw new Error(`请求失败（${response.status}）`);
  const data = response.json as { data?: { id?: string }[]; models?: { name?: string; model?: string }[] };
  const ids = data.data?.map((x) => x.id).filter((x): x is string => typeof x === "string" && !!x.trim()) || data.models?.map((x) => x.name || x.model).filter((x): x is string => typeof x === "string" && !!x.trim()) || [];
  return [...new Set(ids)];
}

async function loadAiModels(settings: { aiEndpoint: string; aiApiKey: string }, receive: (models: string[]) => void, current: () => boolean): Promise<void> {
  try {
    const models = await fetchAiModels(settings);
    if (!models.length) throw new Error("接口没有返回模型");
    if (!current()) return;
    receive(models);
    new Notice(`已获取 ${models.length} 个模型，请从列表选择或手动填写`);
  } catch (e) { if (current()) new Notice(`获取模型列表失败：${(e as Error).message}`, 6000); }
}

async function testAiConnection(settings: { aiEndpoint: string; aiApiKey: string; aiModel: string }): Promise<void> {
  try {
    const models = await fetchAiModels(settings);
    new Notice(`AI 连接成功${models.length ? `，可用模型 ${models.length} 个` : ""}`);
  } catch (e) {
    // 一些 OpenAI 兼容网关禁用了 GET /models，但聊天接口本身可用；用当前模型做一次极短请求兜底测试。
    try {
      validateAiUrl(settings.aiEndpoint);
      const endpoint = settings.aiEndpoint.trim().replace(/\/+$/, "").replace(/\/chat\/completions$/i, "") + "/chat/completions";
      let response: { status: number };
      try {
        response = await curlJson(endpoint, { maxTime: 15, method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json", ...(settings.aiApiKey ? { Authorization: `Bearer ${settings.aiApiKey}` } : {}) }, body: JSON.stringify({ model: settings.aiModel, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }) });
      } catch {
        const native = await requestUrl({ url: endpoint, method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json", ...(settings.aiApiKey ? { Authorization: `Bearer ${settings.aiApiKey}` } : {}) }, body: JSON.stringify({ model: settings.aiModel, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }), throw: false });
        response = { status: native.status };
      }
      if (response.status < 200 || response.status >= 300) throw new Error(`聊天接口请求失败（${response.status}）`);
      new Notice("AI 连接成功；该接口不提供模型列表，请手动填写模型名称", 6000);
    } catch (fallbackError) {
      new Notice(`AI 连接失败：模型接口 ${(e as Error).message}；聊天接口 ${(fallbackError as Error).message}`, 8000);
    }
  }
}

function clamp(n: number, lo: number, hi: number, dflt: number): number {
  if (isNaN(n)) return dflt;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}
