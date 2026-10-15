import { Notice } from "obsidian";
import type LubiPlugin from "../main";
import type { Task } from "../core/tasks";
import { BackgroundEntry, BackgroundPhase, BackgroundRun, backgroundEntries, backgroundRun, backgroundRuntimeMs, executorOf } from "../core/execution";
import { fmtDuration } from "../core/time";
import { button, icon, iconButton, tip } from "./components";

const phaseText = { ready: "待启动", running: "后台运行", review: "待审核", accepted: "已验收" };

function runtimeText(milliseconds: number, tracked: boolean): string {
  if (!tracked) return "未标注后台时长";
  if (milliseconds < 60_000) return "标注用时不足 1min";
  return `标注用时 ${fmtDuration(Math.floor(milliseconds / 60_000))}`;
}

function runtimeLabel(host: HTMLElement, run: BackgroundRun): HTMLElement {
  const label = host.createSpan({ cls: "lubi-background-runtime" });
  label.dataset.runtimeMs = String(backgroundRuntimeMs({ ...run, phase: "ready" }));
  if (run.phase === "running" && run.startedAt) label.dataset.backgroundStartedAt = run.startedAt;
  label.dataset.runtimeTracked = String(!!run.startedAt || run.runtimeMs > 0);
  updateBackgroundClocks(host);
  return label;
}

/** Lightweight clock refresh only; it never persists state or infers Agent completion. */
export function updateBackgroundClocks(root: HTMLElement, now = Date.now()): void {
  for (const label of Array.from(root.querySelectorAll<HTMLElement>(".lubi-background-runtime"))) {
    const stored = Number(label.dataset.runtimeMs) || 0;
    const start = Date.parse(label.dataset.backgroundStartedAt || "");
    const elapsed = Number.isFinite(start) ? Math.max(0, now - start) : 0;
    label.setText(runtimeText(stored + elapsed, label.dataset.runtimeTracked === "true"));
  }
}

export function renderExecutionBadge(host: HTMLElement, task: Task, date: string): void {
  if (executorOf(task) !== "background") return;
  const run = backgroundRun(task, date);
  const badge = host.createDiv({ cls: `lubi-execution-badge is-${run?.phase || "ready"}` });
  icon(badge, "bot", "lubi-icon");
  badge.createSpan({ text: `Agent · ${phaseText[run?.phase || "ready"]}` });
  if (run) runtimeLabel(badge, run);
}

function stateButton(plugin: LubiPlugin, host: HTMLElement, task: Task, date: string, phase: Exclude<BackgroundPhase, "accepted">, label: string, iconName: string, rerender: () => void): HTMLButtonElement {
  const control = iconButton(host, iconName, label, async () => {
    if (control.disabled) return;
    control.disabled = true;
    try { await plugin.tasks.setBackgroundPhase(task.id, date, phase); }
    catch (error) { new Notice(`后台状态未更新：${(error as Error).message}`, 6000); }
    finally { control.disabled = false; rerender(); }
  }, "lubi-background-action");
  control.dataset.backgroundAction = phase;
  return control;
}

export function renderBackgroundAction(plugin: LubiPlugin, host: HTMLElement, task: Task, date: string, rerender: () => void): void {
  if (executorOf(task) !== "background" || plugin.tasks.isDoneOn(task, date)) return;
  const phase = backgroundRun(task, date)?.phase || "ready";
  if (phase === "ready") stateButton(plugin, host, task, date, "running", "标记 Agent 后台运行（仅标注，不启动 Agent）", "bot", rerender);
  else if (phase === "running") stateButton(plugin, host, task, date, "review", "标记结果待审核（不完成任务、不记录本人用时）", "inbox", rerender);
}

export interface ExecutionActions {
  edit: (task: Task, occurrenceDate: string) => void;
  record: (task: Task, occurrenceDate: string) => void;
  followup: (task: Task) => void;
}

function entryBody(plugin: LubiPlugin, host: HTMLElement, entry: BackgroundEntry, actions: ExecutionActions): HTMLElement {
  const row = host.createDiv({ cls: "lubi-execution-item", attr: { "data-task-id": entry.task.id, "data-occurrence-date": entry.date } });
  const title = button(row, entry.task.title, () => actions.edit(entry.task, entry.date), { cls: "lubi-execution-title lubi-quiet-action" });
  title.setAttribute("aria-label", `编辑 ${entry.task.title}`);
  const meta = row.createDiv({ cls: "lubi-execution-meta" });
  const project = plugin.tasks.projectOf(entry.task);
  if (project) meta.createSpan({ text: project.title });
  if (entry.task.repeat.kind !== "none") meta.createSpan({ text: `发生日 ${entry.date}` });
  runtimeLabel(meta, entry.run);
  return row;
}

/** Global queues are intentionally independent of the selected planning date. */
export function renderExecutionQueues(plugin: LubiPlugin, host: HTMLElement, rerender: () => void, actions: ExecutionActions, attentionHost: HTMLElement = host): void {
  const review = backgroundEntries(plugin.tasks.all, "review"), running = backgroundEntries(plugin.tasks.all, "running");
  {
    const card = attentionHost.createDiv({ cls: "lubi-section lubi-list-card lubi-attention-card" });
    if (!attentionHost.classList.contains("lubi-card")) card.addClass("lubi-card");
    const head = card.createDiv({ cls: "lubi-panel-head" });
    head.createEl("h3", { cls: "lubi-panel-title", text: "需我处理" });
    head.createSpan({ cls: "lubi-muted", text: `${review.length} 待审核` });
    card.createDiv({ cls: "lubi-muted lubi-execution-note", text: "跨日期汇总；验收不自动记时，记用时默认不验收。" });
    if (!review.length) card.createDiv({ cls: "lubi-muted lubi-attention-empty", text: "没有待审核的结果。" });
    const list = card.createDiv({ cls: "lubi-execution-list" });
    for (const entry of review) {
      const row = entryBody(plugin, list, entry, actions), controls = row.createDiv({ cls: "lubi-execution-actions" });
      const accept = button(controls, "验收完成", async () => {
        if (accept.disabled) return;
        accept.disabled = true;
        try { await plugin.tasks.setDone(entry.task.id, entry.date, true); }
        catch (error) { new Notice(`未能验收：${(error as Error).message}`, 6000); }
        finally { accept.disabled = false; rerender(); }
      }, { cls: "lubi-btn-sm lubi-review-accept" });
      accept.dataset.reviewAction = "accept";
      const rework = button(controls, "返工", async () => {
        if (rework.disabled) return;
        rework.disabled = true;
        try { await plugin.tasks.setBackgroundPhase(entry.task.id, entry.date, "ready"); }
        catch (error) { new Notice(`未能标记返工：${(error as Error).message}`, 6000); }
        finally { rework.disabled = false; rerender(); }
      }, { cls: "lubi-btn-sm" });
      rework.dataset.reviewAction = "rework";
      tip(rework, "标记待重新启动；不会自动重启 Agent");
      const record = button(controls, "记用时", () => actions.record(entry.task, entry.date), { cls: "lubi-btn-sm" });
      record.dataset.reviewAction = "record";
      const followup = button(controls, "添加后续动作", () => actions.followup(entry.task), { cls: "lubi-btn-sm" });
      followup.dataset.reviewAction = "followup";
    }
    // Calendar-day distribution is already present; attention results deserve the first position.
    attentionHost.prepend(card);
  }
  {
    const card = host.createEl("details", { cls: "lubi-section lubi-list-card lubi-background-card" });
    if (!host.classList.contains("lubi-card")) card.addClass("lubi-card");
    card.open = true;
    card.createEl("summary", { text: `Agent 后台 · ${running.length}`, attr: { "aria-label": `后台运行 ${running.length} 项；仅手动标注，不计入本人实际用时` } });
    card.createDiv({ cls: "lubi-muted lubi-execution-note", text: "仅手动标注，不控制 Agent，不计入本人实际用时。" });
    const list = card.createDiv({ cls: "lubi-execution-list" });
    if (!running.length) list.createDiv({ cls: "lubi-muted lubi-pad", text: "当前没有标注为运行中的后台任务。" });
    for (const entry of running) {
      const row = entryBody(plugin, list, entry, actions), controls = row.createDiv({ cls: "lubi-execution-actions" });
      stateButton(plugin, controls, entry.task, entry.date, "review", "标记结果待审核（不完成任务、不记录本人用时）", "inbox", rerender);
      const edit = button(controls, "编辑", () => actions.edit(entry.task, entry.date), { cls: "lubi-btn-sm" });
      edit.dataset.backgroundEdit = entry.task.id;
    }
    host.prepend(card);
  }
}
