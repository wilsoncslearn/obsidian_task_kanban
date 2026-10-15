// Task completion and personal time are independent facts.
// Explicit record entry may optionally complete a task; planned backfill stays pending.

import { Notice } from "obsidian";
import type LubiPlugin from "../main";
import { normalizeEstimatedMinutes, ParsedLine, PENDING_KEY, Rec, serializeRecord } from "../core/records";
import { Task, DoneLog, blankTask } from "../core/tasks";
import { fmtDuration, hmToMin, minToHM, nowHM, todayStr, isValidDate } from "../core/time";
import { planOccurrences } from "../core/planning";
import { categoryOf } from "../settings";
import { button, icon, iconButton, tip, undoNotice } from "./components";
import { renderBackgroundAction, renderExecutionBadge } from "./execution";

/** 打开「新建 · 已完成」记录框；onRec 在记录真正保存后回调（取消则不调用） */
export type OpenRecord = (defaults?: Partial<Rec>, onRec?: (rec: Rec) => void | Promise<void>, completionDate?: string) => void;

/** 当天清单：排期投影 + 原有记录任务；只有推导出跨度的父任务不单列。 */
export function dayTasks(plugin: LubiPlugin, date: string): Task[] {
  const items = new Map(plugin.tasks.forDate(date).filter(t => !plugin.tasks.children(t.id).length).map(t => [t.id, t]));
  for (const { task } of planOccurrences(plugin.tasks.all, [date])) items.set(task.id, task);
  return [...items.values()].sort((a, b) => a.order - b.order || a.created.localeCompare(b.created));
}

/** 按父任务分组渲染；只有一组且无父任务时不显示组标题 */
export function groupedRows(plugin: LubiPlugin, list: HTMLElement, items: Task[], edit: (task: Task) => void, row: (group: HTMLElement, task: Task) => void): void {
  const groups = new Map<string, { parent?: Task; title: string; tasks: Task[] }>();
  for (const task of items) {
    const parents = plugin.tasks.pathOf(task).slice(0, -1);
    const project = plugin.tasks.projectOf(task);
    const key = project ? `project:${project.id}` : parents.map((p) => p.id).join("/") || "__root__";
    if (!groups.has(key)) groups.set(key, { parent: project ? undefined : parents[parents.length - 1], title: project?.title || parents.map((p) => p.title).join(" / "), tasks: [] });
    groups.get(key)!.tasks.push(task);
  }
  for (const group of groups.values()) {
    const section = list.createDiv({ cls: "lubi-task-group" });
    if (group.title && !group.parent) section.createDiv({ cls: "lubi-task-group-title lubi-muted", text: group.title });
    else if (group.parent) {
      const path = button(section, group.title, () => edit(group.parent!), { cls: "lubi-task-group-title" });
      tip(path, `编辑父任务：${group.title}`);
    }
    else if (groups.size > 1) section.createDiv({ cls: "lubi-task-group-title lubi-muted", text: "独立任务" });
    for (const task of group.tasks) row(section, task);
  }
}

/** 某天的任务清单（分组 + 任务行）。decorate 用于任务页追加拖拽等能力。 */
export function renderDayTaskList(plugin: LubiPlugin, list: HTMLElement, date: string, rerender: () => void, openNew: OpenRecord, edit: (t: Task) => void, decorate?: (li: HTMLElement, t: Task) => void, sortByTime = false): Task[] {
  const items = dayTasks(plugin, date);
  if (sortByTime) {
    const time = (task: Task) => task.start ? hmToMin(task.start) : Number.MAX_SAFE_INTEGER;
    items.sort((a, b) => time(a) - time(b));
  }
  groupedRows(plugin, list, items, edit, (group, t) => {
    const li = taskRow(plugin, group, t, date, rerender, openNew, () => edit(t));
    decorate?.(li, t);
  });
  return items;
}

const sameRecord = (r: Rec, taskId: string, log: DoneLog) =>
  r.task === taskId && r.start === log.start && r.title === log.title && r.category === log.category;

const logOf = (r: Rec): DoneLog => ({ date: r.date, start: r.start, title: r.title, category: r.category });

function firstTimeCategory(plugin: LubiPlugin): string {
  return plugin.settings.categories.find((c) => c.kind === "time")?.name || "日常";
}

/** 这天是否已有关联该任务的记录 */
export async function hasLinkedRecord(plugin: LubiPlugin, taskId: string, date: string): Promise<boolean> {
  return (await plugin.journal.read(date)).some((r) => r.rec.task === taskId);
}

const plannedWrites = new WeakMap<LubiPlugin, Set<string>>();

/** Explicit planned backfill only. Never guesses time or changes task completion. */
export async function logDone(plugin: LubiPlugin, t: Task, date: string, rerender?: () => void): Promise<Rec | null> {
  const current = plugin.tasks.byId(t.id);
  if (!current) { new Notice("任务已不存在，未补记"); return null; }
  const forecast = normalizeEstimatedMinutes(current.estimate);
  if (!isValidDate(date) || date > todayStr() || !/^([01]\d|2[0-3]):[0-5]\d$/.test(current.start) || !forecast) {
    new Notice("按计划补记需要已发生的日期、明确的计划开始时间及预计用时；未猜测时间。", 6000); return null;
  }
  const key = `${current.id}:${date}`;
  let active = plannedWrites.get(plugin);
  if (!active) { active = new Set(); plannedWrites.set(plugin, active); }
  if (active.has(key)) return null;
  active.add(key);
  try {
    if (await hasLinkedRecord(plugin, current.id, date)) { new Notice("已有对应记录，请在时间轴核对，未重复补记。", 5000); return null; }
    const category = current.category && categoryOf(plugin.settings, current.category).kind === "time" ? current.category : firstTimeCategory(plugin);
    const rec: Rec = { date, start: current.start, minutes: forecast, estimatedMinutes: forecast, category, title: current.title, task: current.id, extra: { [PENDING_KEY]: "按计划" } };
    await plugin.journal.add(rec);
    undoNotice(`已按计划补记「${current.title}」（待确认），任务完成状态未改变`, async () => {
      const matches = (await plugin.journal.read(date)).filter(row => serializeRecord(row.rec) === serializeRecord(rec));
      if (matches.length !== 1) { new Notice("补记已被核对、修改或出现相同记录，未强行撤销，请在时间轴核对。", 6000); return; }
      await plugin.journal.remove(date, matches[0].line);
      rerender?.();
    });
    return rec;
  } catch (error) {
    new Notice(`未能按计划补记：${(error as Error).message}。任务完成状态未改变。`, 6000); return null;
  } finally { active.delete(key); }
}

/** Compatibility hooks: legacy settings cannot implicitly fabricate or erase actual records. */
export async function afterDone(_plugin: LubiPlugin, _t: Task, _date: string, _openNew?: OpenRecord, _rerender?: () => void): Promise<void> {}
export async function afterUndone(_plugin: LubiPlugin, _id: string, _date: string, _rerender: () => void): Promise<void> {}

/** An explicit 'complete and record' caller may associate a saved actual record. */
export async function completeFromRecord(plugin: LubiPlugin, taskId: string, date: string, rec: Rec): Promise<void> {
  if (!plugin.tasks.byId(taskId)) return;
  await plugin.tasks.setDone(taskId, date, true);
  await plugin.tasks.setDoneLog(taskId, date, logOf(rec));
}

/**
 * 新增一条记录。时间类、且还没关联任务的记录会同时生成一个「已完成」任务（origin = record），
 * 让每日页补记的事项也出现在任务页。写日记失败时回滚任务，调用方的 rec 不被修改。
 */
export async function addRecordAsDone(plugin: LubiPlugin, rec: Rec): Promise<Rec> {
  const r: Rec = { ...rec, extra: { ...rec.extra } };
  // 表单已取过快照（也包括当时未填预计）；其他新增入口才在这里补取。
  if (r.task && !Object.prototype.hasOwnProperty.call(r, "estimatedMinutes")) r.estimatedMinutes = normalizeEstimatedMinutes(plugin.tasks.byId(r.task)?.estimate);
  const isTime = categoryOf(plugin.settings, r.category).kind !== "money" && r.minutes > 0;
  if (!isTime || r.task) {
    await plugin.journal.add(r);
    return r;
  }
  const task = blankTask({
    title: r.title,
    category: r.category,
    date: r.date,
    start: r.start,
    estimate: r.minutes,
    status: "done",
    doneAt: new Date().toISOString(),
    origin: "record",
    doneLogs: { [r.date]: logOf(r) },
  });
  await plugin.tasks.upsert(task);
  r.task = task.id;
  try {
    await plugin.journal.add(r);
  } catch (e) {
    await plugin.tasks.remove(task.id);
    throw e;
  }
  return r;
}

/**
 * 记录被界面修改（拖动、改时长、编辑窗口）后，保持与任务的配对：
 * 由这条记录生成的任务同步标题 / 分类 / 时间；兼容旧关联标记，但取消完成不删除实际记录。
 */
export async function syncLinkedTask(plugin: LubiPlugin, old: Rec, next: Rec): Promise<void> {
  const id = next.task || old.task;
  if (!id) return;
  const t = plugin.tasks.byId(id);
  if (!t) return;
  const log = t.doneLogs?.[old.date];
  const paired = !!log && sameRecord(old, id, log);
  if (t.origin === "record") {
    await plugin.tasks.upsert({
      ...t,
      title: next.title,
      category: categoryOf(plugin.settings, next.category).kind === "time" ? next.category : t.category,
      start: next.start,
      estimate: next.minutes > 0 ? next.minutes : t.estimate,
      doneLogs: paired || !log ? { ...(t.doneLogs || {}), [old.date]: logOf(next) } : t.doneLogs,
    });
  } else if (paired) {
    await plugin.tasks.setDoneLog(id, old.date, logOf(next));
  }
}

/** Deleting a record preserves planned tasks and their completion; record-origin placeholders stay compatible. */
export async function deleteRecord(plugin: LubiPlugin, date: string, row: ParsedLine, rerender: () => void): Promise<void> {
  const rec = row.rec;
  await plugin.journal.remove(date, row.line);
  let removedTask: Task | null = null;
  const task = rec.task ? plugin.tasks.byId(rec.task) : undefined;
  const log = task?.doneLogs?.[date];
  if (task) {
    try {
      const others = (await plugin.journal.linkedTo(new Set([task.id]))).length;
      if (task.origin === "record" && task.repeat.kind === "none" && !plugin.tasks.children(task.id).length && !others) {
        const original = JSON.parse(JSON.stringify(task)) as Task;
        await plugin.tasks.remove(task.id);
        removedTask = original;
      } else if (log && sameRecord(rec, task.id, log)) await plugin.tasks.setDoneLog(task.id, date, null);
    } catch (error) { new Notice(`记录已删除，但关联任务处理未完成：${(error as Error).message}。可撤销记录或刷新后核对。`, 7000); }
  }
  undoNotice(`已删除记录「${rec.title}」${removedTask ? "及其记录生成项" : task ? "；规划任务与完成状态已保留" : ""}`, async () => {
    if (removedTask && !plugin.tasks.byId(removedTask.id)) await plugin.tasks.upsert(removedTask);
    const present = (await plugin.journal.read(date)).some(row => serializeRecord(row.rec) === serializeRecord(rec));
    if (!present) await plugin.journal.add({ ...rec, extra: { ...rec.extra } });
    const latest = task ? plugin.tasks.byId(task.id) : undefined;
    if (latest && log && !removedTask && !latest.doneLogs?.[date]) {
      try { await plugin.tasks.setDoneLog(latest.id, date, log); }
      catch (error) { new Notice(`记录已恢复，旧关联标记未更新：${(error as Error).message}`, 6000); }
    }
    rerender();
  });
  rerender();
}

export function taskRow(plugin: LubiPlugin, ul: HTMLElement, t: Task, date: string, rerender: () => void, openNew: OpenRecord, onClick?: () => void, options: { compact?: boolean; span?: string; timed?: boolean; parentSeparator?: string; hideContext?: boolean } = {}): HTMLElement {
  const done = plugin.tasks.isDoneOn(t, date);
  const li = ul.createDiv({ cls: `lubi-task ${done ? "is-done" : ""} ${t.blocked ? "is-blocked" : ""}`.trim() });
  const cb = li.createEl("input", { type: "checkbox" });
  cb.checked = done;
  cb.setAttribute("aria-label", `${done ? "取消完成" : "标记完成"} ${t.title}（${date}）；不修改实际记录`);
  cb.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (cb.dataset.busy) { e.preventDefault(); return; } // 连点时等上一次写盘完成
    cb.dataset.busy = "1";
    const requested = cb.checked;
    cb.disabled = true;
    try { await plugin.tasks.setDone(t.id, date, requested); }
    catch (error) { new Notice(`任务更新失败：${(error as Error).message}`, 6000); }
    finally { delete cb.dataset.busy; cb.disabled = false; cb.checked = plugin.tasks.isDoneOn(plugin.tasks.byId(t.id) || t, date); }
    rerender();
  });
  const body = li.createDiv({ cls: "lubi-task-body" });
  const line = onClick
    ? body.createEl("button", { cls: "lubi-task-title lubi-task-title-button", attr: { type: "button", "aria-label": `编辑 ${t.title}` } })
    : body.createDiv({ cls: "lubi-task-title" });
  if (onClick) line.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
  line.createSpan({ cls: "lubi-task-title-text", text: t.title });
  if (t.blocked) tip(icon(line, "octagon-alert", "lubi-icon lubi-blocked-icon"), "受阻");
  if (t.origin === "record") tip(line, `由记录生成${onClick ? " · 点击编辑" : ""}：${t.title}`);
  const parents = plugin.tasks.pathOf(t).slice(0, -1);
  const meta: string[] = [];
  const project = plugin.tasks.projectOf(t);
  if (project && !options.compact && !options.hideContext) meta.push(project.title);
  else if (parents.length && !options.compact && !options.hideContext) meta.push(parents.map((p) => p.title).join(options.parentSeparator || " / "));
  if (t.start && options.timed !== false) meta.push(options.compact && t.estimate ? `${t.start}–${minToHM(hmToMin(t.start) + t.estimate)}` : t.start);
  if (options.span) meta.push(options.span);
  if (t.estimate && !options.compact) meta.push(fmtDuration(t.estimate));
  if (t.repeat.kind !== "none" && !options.compact) meta.push("重复");
  if (done && t.repeat.kind === "none" && !t.date) meta.push("未排期已完成");
  if (meta.length) {
    const text = meta.join(" · ");
    const metadata = body.createDiv({ cls: "lubi-task-meta" });
    meta.forEach((value, index) => {
      if (index) metadata.appendChild(document.createTextNode(" · "));
      metadata.createSpan({ cls: value === t.start ? "lubi-task-meta-time" : "lubi-task-meta-item", text: value });
    });
    tip(metadata, text);
  }
  renderExecutionBadge(body, t, date);
  const acts = li.createDiv({ cls: "lubi-task-actions" });
  renderBackgroundAction(plugin, acts, t, date, rerender);
  // Record-only and complete-and-record are explicit choices inside the same form.
  const record = button(acts, "记用时", () => openNew({
    title: t.title, category: t.category || undefined, task: t.id,
    start: date === todayStr() ? nowHM() : undefined,
  }, undefined, date), { cls: "lubi-btn-sm lubi-task-start" });
  record.setAttribute("aria-label", `记「${t.title}」的本人用时；默认不完成，可在窗口中勾选同时完成`);
  record.dataset.lubiFocus = `task:record:${t.id}`;
  if (date <= todayStr() && t.start && normalizeEstimatedMinutes(t.estimate)) {
    void hasLinkedRecord(plugin, t.id, date).then(has => {
      if (has) return;
      const fill = iconButton(acts, "clock", `按计划补记「${t.title}」：待确认，不改变完成状态`, async () => {
        if (fill.disabled) return;
        fill.disabled = true;
        try { await logDone(plugin, plugin.tasks.byId(t.id) || t, date, rerender); }
        finally { fill.disabled = false; rerender(); }
      }, "lubi-task-unlogged");
    }).catch(() => undefined);
  }
  if (!done && t.repeat.kind !== "none") {
    iconButton(acts, "circle-off", `跳过「${t.title}」${date}（仅本次）`, async () => {
      try {
        await plugin.tasks.toggleSkip(t.id, date);
        new Notice(`已跳过「${t.title}」${date}，重复规则未改变。`, 4000);
        rerender();
      } catch (error) { new Notice(`跳过任务失败：${(error as Error).message}`, 6000); }
    }, "lubi-task-skip");
  }
  if (onClick) li.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("button, input")) return;
    onClick();
  });
  return li;
}
