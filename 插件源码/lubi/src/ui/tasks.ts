import { categoryTone } from "./monochrome";
// 计划页：同一日期范围的日历 / 甘特图 / 列表。

import { Notice } from "obsidian";
import type LubiPlugin from "../main";
import { Task, blankTask } from "../core/tasks";
import { fmtDuration, hmToMin, minToHM, nowHM, shortDate, todayStr, weekdayZh } from "../core/time";
import { button, el, HOUR_PX, hoverTip, infoTip, iconButton, segmented, stopAll, undoNotice } from "./components";
import { RecordModal, TaskModal, openUnifiedRecord } from "./modals";
import { dayTasks, groupedRows, OpenRecord, taskRow } from "./taskList";
import { startDrag } from "./drag";
import { explicitSpan, GanttPeriod, ganttWindow, stepGanttDate } from "../core/gantt";
import { renderGantt } from "./gantt";
import { renderDailyGantt } from "./dailyGantt";
import { planDatePatch, planInbox, planOccurrences } from "../core/planning";
import { renderMonthCalendar, renderRangeList } from "./planningViews";
import { renderCalendarDay } from "./calendarDay";
import { renderDayPlan } from "./daySummary";
import { ParsedLine, PENDING_KEY, Rec } from "../core/records";
import { renderExecutionQueues } from "./execution";
import { backgroundEntries } from "../core/execution";

const SNAP = 15;
let weekDayLabelId = 0;

export interface TasksState {
  selectedDate: string;
  scheduleView: "calendar" | "gantt" | "list";
  period: GanttPeriod;
  ganttCollapsed: Set<string>;
}

type ScheduleFields = Pick<Task, "date" | "start" | "estimate" | "startDate" | "endDate">;

async function writeSchedule(plugin: LubiPlugin, task: Task, patch: Partial<ScheduleFields>): Promise<void> {
  const attempted = { ...(plugin.tasks.byId(task.id) || task), ...patch };
  const saving = plugin.tasks.upsert(attempted);
  const writtenStamp = attempted.updated;
  try { await saving; }
  catch (error) {
    const latest = plugin.tasks.byId(task.id);
    if (latest === attempted) {
      for (const key of Object.keys(patch) as (keyof ScheduleFields)[]) if (latest[key] === patch[key]) Object.assign(latest, { [key]: task[key] });
      if (latest.updated === writtenStamp) latest.updated = task.updated;
    }
    throw error;
  }
}

/** 只恢复本次实际改动且仍保持本次值的字段，绝不覆盖撤销期间对任务的其他修改。 */
export async function updateScheduleWithUndo(plugin: LubiPlugin, id: string, patch: Partial<ScheduleFields>, message: string, rerender: () => void, onSaved?: () => void): Promise<void> {
  const task = plugin.tasks.byId(id);
  if (!task) { new Notice("任务已不存在，无法调整"); return; }
  const keys = Object.keys(patch) as (keyof ScheduleFields)[];
  const original: ScheduleFields = { date: task.date, start: task.start, estimate: task.estimate, startDate: task.startDate, endDate: task.endDate };
  const changed = keys.filter((key) => original[key] !== patch[key]);
  if (!changed.length) { rerender(); onSaved?.(); return; }
  const written: ScheduleFields = { ...original, ...patch };
  try {
    await writeSchedule(plugin, task, patch);
    undoNotice(message, async () => {
      const latest = plugin.tasks.byId(id);
      if (!latest) { new Notice("任务已删除，无法撤销"); return; }
      const restored: Partial<ScheduleFields> = {};
      let conflicts = 0;
      for (const key of changed) {
        if (latest[key] === written[key]) Object.assign(restored, { [key]: original[key] });
        else conflicts++;
      }
      if (!Object.keys(restored).length) { new Notice("任务的排期已再次修改，未覆盖新修改"); return; }
      const candidate = { ...latest, ...restored };
      if (["date", "startDate", "endDate"].some(key => Object.prototype.hasOwnProperty.call(restored, key)) && (candidate.startDate || candidate.endDate)) {
        const span = explicitSpan(candidate);
        if (!span || (candidate.date && (candidate.date < span.from || candidate.date > span.to))) {
          new Notice("排期已再次修改，未撤销以免造成日期冲突"); return;
        }
      }
      try {
        await writeSchedule(plugin, latest, restored);
        if (conflicts) new Notice("已撤销未再次修改的排期字段；其他修改已保留");
        rerender();
      } catch (e) { new Notice(`撤销失败：${(e as Error).message}`, 6000); }
    });
    rerender();
    onSaved?.();
  } catch (e) { new Notice(`调整失败：${(e as Error).message}`, 6000); rerender(); }
}

export async function renderTasks(plugin: LubiPlugin, host: HTMLElement, date: string, state: TasksState, rerender: () => void): Promise<void> {
  host.empty();
  host.addClass("lubi-tasks", "lubi-planning");
  host.toggleClass("is-gantt", state.scheduleView === "gantt");
  host.toggleClass("is-list", state.scheduleView === "list");
  const calendarDay = state.scheduleView === "calendar" && state.period === "day";
  host.toggleClass("is-calendar-day", calendarDay);
  const openNew: OpenRecord = (d, onRec, completionDate) => openUnifiedRecord(plugin, date, d, async rec => { if (rec && onRec) await onRec(rec); rerender(); }, completionDate);
  const edit = (task: Task, occurrenceDate = date) => new TaskModal(plugin.app, plugin, { task, recordDate: occurrenceDate, onSaved: rerender }).open();
  const create = (defaults: Partial<Task> = {}) => new TaskModal(plugin.app, plugin, { defaults, onSaved: rerender }).open();
  let rows: ParsedLine[] = [], timeAvailable = true;
  try { rows = await plugin.journal.read(date); } catch { timeAvailable = false; }
  renderPlanningOverview(plugin, host, date, rows.map(row => row.rec), timeAvailable);
  const days = ganttWindow(state.selectedDate, state.period);
  const head = renderPlanningHead(host, state, days, rerender);
  if (calendarDay) {
    const day = host.createDiv({ cls: "lubi-calendar-day" });
    await renderCalendarDay(plugin, day, date, rerender, (side, records) => {
      side.addClass("lubi-tasks-left", "lubi-task-lists");
      renderLists(plugin, side, date, rerender, openNew, edit, create, true, records, day.querySelector<HTMLElement>(".lubi-today-main")!);
      renderPersonalTime(plugin, side, date, rows, timeAvailable, rerender, openNew);
    }, timeAvailable ? rows : undefined);
    const summary = day.querySelector<HTMLElement>(".lubi-today-summary")!;
    head.querySelector(".lubi-schedule-range")!.after(summary);
    const top = day.querySelector<HTMLElement>(".lubi-today-top")!;
    if (!top.childElementCount) top.remove();
    bindDrop(plugin, day.querySelector<HTMLElement>(".lubi-tl-canvas")!, date, 0, rerender);
    return;
  }
  const top = host.createDiv({ cls: "lubi-tasks-top lubi-planning-top" });
  const lists = top.createDiv({ cls: "lubi-tasks-left lubi-task-lists" });
  const main = top.createDiv({ cls: "lubi-tasks-week lubi-planning-main" });
  top.appendChild(lists);
  const dayList = state.scheduleView === "list" && state.period === "day";
  renderLists(plugin, lists, date, rerender, openNew, edit, create, true, undefined, main, dayList ? main : lists);
  renderPersonalTime(plugin, lists, date, rows, timeAvailable, rerender, openNew);
  if (dayList) return;
  const card = main.createDiv({ cls: `lubi-card ${state.scheduleView === "gantt" ? "lubi-gantt-card" : state.scheduleView === "list" ? "lubi-plan-list-card" : state.period === "month" ? "lubi-month-card" : "lubi-week-card"}` });
  const save = (id: string, patch: Partial<ScheduleFields>, message: string) => updateScheduleWithUndo(plugin, id, patch, message, rerender);
  const drop = (target: HTMLElement, day: string) => bindDrop(plugin, target, day, null, rerender, true, () => {
    if (state.scheduleView === "calendar" && state.period === "month" && day.slice(0, 7) !== date.slice(0, 7)) plugin.openDate(day, "tasks");
  });
  if (state.scheduleView === "list") renderRangeList(plugin, card, days, rerender, edit, makeDraggable, drop);
  else if (state.scheduleView === "gantt") {
    if (state.period === "day") { card.addClass("lubi-daily-gantt-card"); renderDailyGantt(plugin, card, date, rerender, edit, save); }
    else renderGantt(plugin, card, days, state.ganttCollapsed, rerender, edit, save);
  } else if (state.period === "month") renderMonthCalendar(plugin, card, date, edit, makeDraggable, drop);
  else renderCalendarSchedule(plugin, card, date, state, rerender, edit);
}

/** Read-only page metrics; background clocks never become journal minutes. */
function renderPlanningOverview(plugin: LubiPlugin, host: HTMLElement, date: string, records: Rec[], timeAvailable: boolean): void {
  const intro = host.createDiv({ cls: "lubi-plan-intro" });
  intro.createDiv({ cls: "lubi-plan-overline", text: "LUBI / PLAN & DO" });
  intro.createEl("h1", { cls: "lubi-plan-heading", text: "任务与计划" });
  intro.createDiv({ cls: "lubi-muted", text: "做完打勾，花了时间点「记用时」。Agent 后台与本人投入分开看。" });
  const overview = host.createDiv({ cls: "lubi-plan-overview", attr: { "aria-label": `${date} 的计划摘要` } });
  const scheduled = planOccurrences(plugin.tasks.all, [date]);
  const review = backgroundEntries(plugin.tasks.all, "review").length;
  const running = backgroundEntries(plugin.tasks.all, "running").length;
  const queued = new Set([...backgroundEntries(plugin.tasks.all, "review"), ...backgroundEntries(plugin.tasks.all, "running")].map(entry => entry.task.id));
  const actual = records.filter(record => record.minutes > 0 && (!record.extra[PENDING_KEY] || record.extra[PENDING_KEY] === "实际开始未核对"));
  const minutes = actual.reduce((sum, record) => sum + record.minutes, 0);
  const pending = records.filter(record => record.minutes > 0 && record.extra[PENDING_KEY] && record.extra[PENDING_KEY] !== "实际开始未核对").length;
  const metric = (id: string, label: string, value: string, note: string) => {
    const item = overview.createDiv({ cls: "lubi-plan-metric", attr: { "data-plan-metric": id } });
    item.createDiv({ cls: "lubi-plan-metric-label", text: label });
    item.createDiv({ cls: "lubi-plan-metric-value", text: value });
    item.createDiv({ cls: "lubi-plan-metric-note", text: note });
  };
  metric("todo", "当天待做", String(scheduled.filter(item => !item.done && !queued.has(item.task.id)).length), `${date} · 后台和待审核另列`);
  metric("review", "需我处理", String(review), "跨日期的待审核结果");
  metric("background", "Agent 后台", String(running), "手动标注 · 不计入本人用时");
  metric("actual", "本人已记录", timeAvailable ? fmtDuration(minutes) : "—", !timeAvailable ? "用时暂不可读，未按 0 计算" : pending ? `${pending} 条按计划待确认未计入` : "本人记录之和，不是后台运行时间");
}

/** A small journal-backed sidebar, with the existing record editor for multi-segment safety. */
function renderPersonalTime(plugin: LubiPlugin, host: HTMLElement, date: string, rows: ParsedLine[], available: boolean, rerender: () => void, openNew: OpenRecord): void {
  const card = host.createDiv({ cls: "lubi-card lubi-section lubi-personal-time" });
  const head = card.createDiv({ cls: "lubi-panel-head" });
  head.createEl("h3", { cls: "lubi-panel-title", text: "我的用时" });
  const timed = rows.filter(row => row.rec.minutes > 0);
  head.createSpan({ cls: "lubi-muted", text: date });
  card.createDiv({ cls: "lubi-muted lubi-execution-note", text: "来自本人日记；待确认会单独标注，不包含后台时长。" });
  const list = card.createDiv({ cls: "lubi-personal-time-list" });
  if (!available) list.createDiv({ cls: "lubi-muted lubi-pad", attr: { role: "status" }, text: "用时暂不可读。任务仍可操作，可稍后刷新。" });
  else if (!timed.length) list.createDiv({ cls: "lubi-muted lubi-pad", text: "这一天还没有用时记录。" });
  for (const row of timed.slice(-4).reverse()) {
    const record = row.rec;
    const entry = button(list, record.title, () => new RecordModal(plugin.app, plugin, { date, rec: record, line: row.line, onSaved: rerender }).open(), { cls: "lubi-personal-time-entry lubi-quiet-action" });
    entry.setAttribute("aria-label", `编辑 ${record.title} 的用时记录，${fmtDuration(record.minutes)}`);
    entry.createSpan({ cls: "lubi-personal-time-minutes", text: fmtDuration(record.minutes) });
    entry.createSpan({ cls: "lubi-personal-time-meta", text: `${record.category} · ${record.start}${record.extra[PENDING_KEY] ? " · 待核对" : ""}` });
  }
  if (timed.length > 4) card.createDiv({ cls: "lubi-muted lubi-personal-time-more", text: `另有 ${timed.length - 4} 条，请在日历时间轴查看与编辑。` });
  button(card, "记一笔用时", () => openNew({}), { cls: "lubi-personal-time-add" });
  const background = host.querySelector(".lubi-background-card");
  if (background) background.after(card); else host.prepend(card);
}

function renderPlanningHead(host: HTMLElement, state: TasksState, days: string[], rerender: () => void): HTMLElement {
  const head = host.createDiv({ cls: "lubi-panel-head lubi-planning-head" });
  const views = segmented<TasksState["scheduleView"]>(head, [{ id: "calendar", label: "日历" }, { id: "gantt", label: "甘特图" }, { id: "list", label: "列表" }], state.scheduleView, value => { state.scheduleView = value; rerender(); });
  views.addClass("lubi-schedule-switch");
  views.querySelectorAll<HTMLElement>("button").forEach((button, i) => button.dataset.lubiFocus = `schedule:${["calendar", "gantt", "list"][i]}`);
  const periods = segmented<GanttPeriod>(head, [{ id: "day", label: "日" }, { id: "week", label: "周" }, { id: "month", label: "月" }], state.period, value => { state.period = value; rerender(); });
  periods.addClass("lubi-planning-period-switch");
  periods.querySelectorAll<HTMLElement>("button").forEach((button, i) => button.dataset.lubiFocus = `planning-period:${["day", "week", "month"][i]}`);
  head.createSpan({ cls: "lubi-muted lubi-schedule-range", text: days.length === 1 ? days[0] : `${shortDate(days[0])} – ${shortDate(days[days.length - 1])}` });
  const nav = head.createDiv({ cls: "lubi-nav lubi-push-right" });
  const shift = (direction: number) => { state.selectedDate = stepGanttDate(state.selectedDate, state.period, direction); rerender(); };
  const unit = state.period === "day" ? "天" : state.period === "week" ? "周" : "月";
  nav.addClass("lubi-planning-nav");
  const prev = iconButton(nav, "chevron-left", `向前一${unit}`, () => shift(-1)); prev.dataset.lubiFocus = "planning:previous";
  nav.createSpan({ cls: "lubi-nav-date", text: state.period === "day" ? `${shortDate(state.selectedDate)} 周${weekdayZh(state.selectedDate)}` : `${shortDate(days[0])} – ${shortDate(days[days.length - 1])}` });
  if (state.selectedDate !== todayStr()) button(nav, "回到今天", () => { state.selectedDate = todayStr(); rerender(); }, { cls: "lubi-btn-sm lubi-nav-today" }).dataset.lubiFocus = "planning:today";
  const next = iconButton(nav, "chevron-right", `向后一${unit}`, () => shift(1)); next.dataset.lubiFocus = "planning:next";
  return head;
}

// ---------- 左栏 ----------

function renderLists(plugin: LubiPlugin, host: HTMLElement, date: string, rerender: () => void, openNew: OpenRecord, edit: (t: Task) => void, create: (d?: Partial<Task>) => void, showToday: boolean, records?: Rec[], attentionHost: HTMLElement = host, todayHost: HTMLElement = host): void {
  renderExecutionQueues(plugin, host, rerender, {
    edit: (task, occurrenceDate) => new TaskModal(plugin.app, plugin, { task, recordDate: todayStr(), completionDate: occurrenceDate, onSaved: rerender }).open(),
    record: (task, occurrenceDate) => openUnifiedRecord(plugin, todayStr(), { task: task.id, title: task.title, category: task.category }, () => rerender(), occurrenceDate),
    followup: task => create({ title: "", category: task.category, project: task.project, notes: `跟进「${task.title}」` }),
  }, attentionHost);
  const activeBackground = new Set([...backgroundEntries(plugin.tasks.all, "review"), ...backgroundEntries(plugin.tasks.all, "running")].map(entry => entry.task.id));
  if (showToday) {
    const scheduled = planOccurrences(plugin.tasks.all, [date]);
    const candidates = records ? dayTasks(plugin, date) : [...new Map([
      ...scheduled.map(item => [item.task.id, item.task] as const),
      ...plugin.tasks.forDate(date).filter(task => !task.date && task.repeat.kind === "none" && task.status === "done" && task.origin !== "record" && !plugin.tasks.children(task.id).length).map(task => [task.id, task] as const),
    ]).values()];
    let occurrences = candidates.map(task => scheduled.find(item => item.task.id === task.id) || { task, date, from: date, to: date, timed: !!task.start && !!task.date, done: plugin.tasks.isDoneOn(task, date) });
    if (todayHost !== host) occurrences = occurrences.filter(item => !activeBackground.has(item.task.id));
    const logged = new Set(records?.map(rec => rec.task).filter(Boolean));
    // Date alone is not an independent activity for an ancestor used as a group.
    if (records) {
      const ancestors = new Set(occurrences.flatMap(item => plugin.tasks.pathOf(item.task).slice(0, -1).map(t => t.id)));
      occurrences = occurrences.filter(({ task }) => !ancestors.has(task.id) || !!task.start || task.estimate > 0 || logged.has(task.id));
    }
    if (records) occurrences.sort((a, b) => (a.timed ? hmToMin(a.task.start) : 1440) - (b.timed ? hmToMin(b.task.start) : 1440) || a.task.order - b.task.order);
    if (!records) occurrences.sort((a, b) => a.task.order - b.task.order || a.task.created.localeCompare(b.task.created));
    const today = occurrences.map(item => item.task);
    const done = today.filter(t => plugin.tasks.isDoneOn(t, date)).length;
    const renderList = (list: HTMLElement) => {
      const row = (group: HTMLElement, t: Task) => {
        const occurrence = occurrences.find(item => item.task.id === t.id)!;
        const li = taskRow(plugin, group, t, date, rerender, openNew, () => edit(t), { compact: !records, hideContext: !!records, timed: occurrence.timed,
          span: occurrence.from !== occurrence.to ? `${shortDate(occurrence.from)} – ${shortDate(occurrence.to)}` : undefined });
        li.dataset.date = date;
        makeDraggable(li, t);
        bindTaskSort(plugin, li, t, list, rerender);
      };
      if (records) { groupedRows(plugin, list, today, edit, row); return; }
      const active = today.filter(t => !plugin.tasks.isDoneOn(t, date));
      const finished = today.filter(t => plugin.tasks.isDoneOn(t, date));
      groupedRows(plugin, list, active, edit, row);
      if (finished.length) {
        const fold = list.createEl("details", { cls: "lubi-done-fold" });
        fold.createEl("summary", { text: `已完成（${finished.length}）` });
        const inner = fold.createDiv({ cls: "lubi-done-fold-body" });
        groupedRows(plugin, inner, finished, edit, row);
      }
    };
    let card: HTMLElement;
    if (records) card = renderDayPlan(todayHost, date, today.length, done, renderList);
    else {
      card = todayHost.createDiv({ cls: "lubi-section lubi-list-card lubi-selected-day-list", attr: { "data-date": date } });
      if (!todayHost.classList.contains("lubi-card")) card.addClass("lubi-card");
      if (todayHost !== host) card.addClass("lubi-plan-list-card");
      const head = card.createDiv({ cls: "lubi-panel-head" });
      el(head, "h3", "lubi-panel-title", todayHost !== host ? "当天任务" : date === todayStr() ? "今日计划" : `${shortDate(date)} 周${weekdayZh(date)}`);
      head.createSpan({ cls: "lubi-muted", text: `${done}/${today.length} 已做` });
      const list = card.createDiv({ cls: "lubi-task-list" });
      if (todayHost !== host) list.addClass("lubi-plan-range-list");
      if (!today.length) list.createDiv({ cls: "lubi-muted lubi-pad", text: "暂无安排" });
      renderList(list);
    }
    // 整张当天清单都可接收任务，包括空列表、标题和快速输入区域。
    bindDrop(plugin, card, date, null, rerender);
    renderQuickAdd(plugin, card, date, rerender);
  }
  // 未安排：显式跨度和实际记录生成的任务不混入未安排。
  const inbox = planInbox(plugin.tasks.all).filter(task => !activeBackground.has(task.id));
  const ib = host.createDiv({ cls: "lubi-section lubi-list-card" });
  if (!host.classList.contains("lubi-card")) ib.addClass("lubi-card");
  ib.addClass("lubi-inbox-card");
  const ih = ib.createDiv({ cls: "lubi-panel-head" });
  el(ih, "h3", "lubi-panel-title", "未安排");
  ih.createSpan({ cls: "lubi-muted", text: inbox.length ? String(inbox.length) : "" });
  iconButton(ih, "plus", "新建未安排任务", () => create(), "lubi-push-right lubi-inbox-add");
  const il = ib.createDiv({ cls: "lubi-task-list" });
  if (!inbox.length) il.createDiv({ cls: "lubi-muted lubi-pad", text: "暂无未安排任务" });
  groupedRows(plugin, il, inbox, edit, (group, t) => {
    const li = taskRow(plugin, group, t, date, rerender, openNew, () => edit(t), { compact: true });
    makeDraggable(li, t);
    bindTaskSort(plugin, li, t, il, rerender);
    const act = li.querySelector<HTMLElement>(".lubi-task-actions") ?? li.createDiv({ cls: "lubi-task-actions" });
    iconButton(act, "calendar-plus", `安排 ${t.title} 到 ${date}（可撤销）`, () => void updateScheduleWithUndo(plugin, t.id, { date, start: "" }, `${t.title} → ${date}`, rerender));
    iconButton(act, "calendar-days", `为 ${t.title} 选择日期和时间`, () => new TaskModal(plugin.app, plugin, { task: t, focusDate: true, onSaved: rerender }).open());
  });
}

function renderQuickAdd(plugin: LubiPlugin, card: HTMLElement, date: string, rerender: () => void): void {
  const quick = card.createDiv({ cls: "lubi-quick-add" });
  const input = quick.createEl("input", { type: "text", attr: { placeholder: "添加当天任务", "aria-label": `添加 ${date} 的待办`, "data-lubi-focus": "quick-add" } });
  let saving = false;
  const add = async () => {
    const title = input.value.trim();
    if (!title || saving) { input.focus(); return; }
    saving = true;
    try {
      const firstCat = plugin.settings.categories.find((c) => c.kind === "time")?.name || "";
      await plugin.tasks.upsert(blankTask({ title, date, category: firstCat }));
      input.value = "";
      rerender();
    } catch (e) { new Notice(`添加失败：${(e as Error).message}`, 6000); }
    finally { saving = false; }
  };
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.isComposing) return;
    e.preventDefault();
    void add();
  });
  button(quick, "添加", () => void add(), { cls: "lubi-btn-sm" });
}

/** 对同一项目的叶子任务保留可见父级路径；父级名称可直接打开编辑。 */
function makeDraggable(elm: HTMLElement, t: Task): void {
  elm.dataset.taskId = t.id;
  elm.draggable = true;
  elm.addClass("is-draggable");
  elm.addEventListener("dragstart", (e) => {
    e.dataTransfer?.setData("text/lubi-task", t.id);
    if (elm.dataset.date) e.dataTransfer?.setData("text/lubi-task-date", elm.dataset.date);
    e.dataTransfer?.setData("text/plain", t.title);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    elm.addClass("is-dragging");
  });
  elm.addEventListener("dragend", () => elm.removeClass("is-dragging"));
}

/** 清单内排序独立于排期；不同项目不混排，保留可见父级分组。 */
function bindTaskSort(plugin: LubiPlugin, row: HTMLElement, task: Task, list: HTMLElement, rerender: () => void): void {
  const rows = () => Array.from(row.parentElement!.querySelectorAll<HTMLElement>(".lubi-task[data-task-id]"));
  const clear = () => list.querySelectorAll(".is-sort-before, .is-sort-after").forEach(el => el.removeClass("is-sort-before", "is-sort-after"));
  const source = (e: DragEvent) => {
    const id = e.dataTransfer?.getData("text/lubi-task") || list.querySelector<HTMLElement>(".is-dragging")?.dataset.taskId;
    return rows().find(el => el.dataset.taskId === id);
  };
  const move = async (id: string, after: boolean) => {
    const ids = rows().map(el => el.dataset.taskId!);
    if (!ids.includes(id) || id === task.id) return;
    const next = ids.filter(value => value !== id);
    next.splice(next.indexOf(task.id) + (after ? 1 : 0), 0, id);
    if (next.every((value, i) => value === ids[i])) return;
    try { await plugin.tasks.reorder(next); rerender(); }
    catch (e) { new Notice(`排序失败：${(e as Error).message}`, 6000); rerender(); }
  };
  row.addEventListener("dragover", (e) => {
    if (!e.dataTransfer?.types.includes("text/lubi-task") || !source(e)) return;
    e.preventDefault(); e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    clear();
    if (source(e) === row) return;
    const rect = row.getBoundingClientRect();
    row.addClass(e.clientY < rect.top + rect.height / 2 ? "is-sort-before" : "is-sort-after");
  });
  row.addEventListener("dragleave", (e) => {
    if (e.relatedTarget instanceof Node && row.contains(e.relatedTarget)) return;
    clear();
  });
  row.addEventListener("dragend", clear);
  row.addEventListener("drop", (e) => {
    const from = source(e);
    clear();
    if (!from) {
      const id = e.dataTransfer?.getData("text/lubi-task");
      if (Array.from(list.querySelectorAll<HTMLElement>("[data-task-id]")).some(el => el.dataset.taskId === id)) {
        e.preventDefault(); e.stopPropagation();
        new Notice("请在同一项目分组内排序；排序不会改变任务所属项目");
      }
      return; // 从未安排拖入当天仍由卡片的排期处理器负责。
    }
    e.preventDefault(); e.stopPropagation();
    list.closest(".lubi-list-card")?.removeClass("is-drop");
    const rect = row.getBoundingClientRect();
    void move(from.dataset.taskId!, e.clientY >= rect.top + rect.height / 2);
  });
  row.tabIndex = 0;
  row.setAttribute("aria-keyshortcuts", "Alt+ArrowUp Alt+ArrowDown");
  row.addEventListener("keydown", (e) => {
    if (e.target !== row || !e.altKey || !["ArrowUp", "ArrowDown"].includes(e.key)) return;
    const all = rows(), index = all.indexOf(row), neighbor = all[index + (e.key === "ArrowUp" ? -1 : 1)];
    if (!neighbor) return;
    e.preventDefault(); e.stopPropagation();
    const ids = all.map(el => el.dataset.taskId!);
    [ids[index], ids[all.indexOf(neighbor)]] = [ids[all.indexOf(neighbor)], ids[index]];
    const root = list.closest(".lubi-root");
    void plugin.tasks.reorder(ids).then(() => {
      rerender();
      // 刷新有 150ms 防抖；仅在旧行仍存在时恢复相同任务的焦点。
      window.setTimeout(() => {
        if (!row.isConnected) Array.from(root?.querySelectorAll<HTMLElement>("[data-task-id]") || []).find(el => el.dataset.taskId === task.id)?.focus();
      }, 180);
    }).catch(e => { new Notice(`排序失败：${(e as Error).message}`, 6000); rerender(); });
  });
}

// ---------- 日 / 周时间日历 ----------
function renderCalendarSchedule(plugin: LubiPlugin, card: HTMLElement, date: string, state: TasksState, rerender: () => void, edit: (t: Task, date?: string) => void): void {
  const s = plugin.settings;
  const startH = 0, endH = 24;
  const days = ganttWindow(date, state.period);
  const daily = new Map(days.map(day => [day, planOccurrences(plugin.tasks.all, [day])]));
  const grid = card.createDiv({ cls: "lubi-week" });
  grid.style.setProperty("--lubi-calendar-days", String(days.length));
  grid.toggleClass("is-single-day", days.length === 1);
  // 表头 + 全天条
  const corner = grid.createDiv({ cls: "lubi-week-corner" });
  corner.setText("");
  const heads: HTMLElement[] = [];
  for (const d of days) {
    const h = grid.createDiv({ cls: `lubi-week-day ${d === todayStr() ? "is-today" : ""} ${d === date ? "is-selected" : ""}`.trim() });
    heads.push(h);
    const dayButton = h.createEl("button", { cls: "lubi-week-day-button", attr: { type: "button", "aria-current": d === date ? "date" : "false" } });
    const dayLabel = dayButton.createSpan({ cls: "lubi-sr-only", text: `查看 ${d} 周${weekdayZh(d)} 的任务`, attr: { id: `lubi-week-day-label-${++weekDayLabelId}` } });
    dayButton.setAttribute("aria-labelledby", dayLabel.id);
    dayButton.createSpan({ cls: "lubi-week-dow", text: `周${weekdayZh(d)}` });
    dayButton.createSpan({ cls: "lubi-week-date", text: `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` });
    dayButton.addEventListener("click", () => plugin.openDate(d, "tasks"));
    renderLoad(plugin, h, d);
    const allDay = daily.get(d)!.filter(item => !item.timed).map(item => item.task);
    // 没有全天任务就不占表头高度；表头本身仍是全天任务的拖放区
    const strip = allDay.length ? h.createDiv({ cls: "lubi-allday" }) : null;
    if (strip) for (const t of allDay) {
      const doneChip = plugin.tasks.isDoneOn(t, d);
      const chip = strip.createEl("button", { cls: `lubi-allday-chip ${doneChip ? "is-done" : ""}`, attr: { type: "button" } });
      const summary = [
        ...(plugin.tasks.projectOf(t) ? [`项目：${plugin.tasks.projectOf(t)!.title}`] : []),
        `${shortDate(d)} · 全天（未设置开始时间）`,
        `预计用时：${t.estimate > 0 ? fmtDuration(t.estimate) : "未设置"}`,
        doneChip ? "已完成" : "待完成",
      ];
      // aria-labelledby 为读屏提供摘要，不使用会触发 Obsidian 黑色提示的 aria-label。
      const description = chip.createSpan({ cls: "lubi-sr-only", text: `${t.title}。${summary.join("。")}`, attr: { id: `lubi-allday-${d}-${t.id}` } });
      chip.setAttribute("aria-labelledby", description.id);
      hoverTip(chip, ".lubi-allday-chip", () => {
        const title = createDiv({ cls: "lubi-task-tip-title", text: t.title });
        const rows: (string | HTMLElement)[] = [title, ...summary];
        if (t.notes.trim()) rows.push(createDiv({ cls: "lubi-task-tip-notes", text: t.notes }));
        return rows;
      }, "side");
      chip.style.setProperty("--chip", categoryTone(s, t.category));
      chip.createSpan({ text: t.title });
      chip.addEventListener("click", (e) => {
        stopAll(e);
        edit(t, d);
      });
      chip.dataset.date = d;
      makeDraggable(chip, t);
    }
    bindDrop(plugin, h, d, null, rerender);
  }
  // 时间轴 + 7 列
  const body = grid.createDiv({ cls: "lubi-week-body" });
  // 表身有纵向滚动条、表头没有：把滚动条宽度补成表头最右侧的一条空轨道，列线才能上下对齐
  const syncGutter = () => grid.style.setProperty("--lubi-week-sbw", `${Math.max(0, body.offsetWidth - body.clientWidth)}px`);
  window.requestAnimationFrame(syncGutter);
  // No unowned ResizeObserver per render; the next panel render resyncs the gutter.
  const hours = body.createDiv({ cls: "lubi-week-hours" });
  hours.style.height = `${(endH - startH) * HOUR_PX}px`;
  for (let h = startH; h < endH; h++) {
    const l = hours.createDiv({ cls: "lubi-week-hour" });
    l.style.top = `${(h - startH) * HOUR_PX}px`;
    l.setText(`${String(h).padStart(2, "0")}:00`);
  }
  const endLabel = hours.createDiv({ cls: "lubi-week-hour is-day-end" });
  endLabel.style.top = `${(endH - startH) * HOUR_PX}px`;
  endLabel.setText(`${String(endH).padStart(2, "0")}:00`);
  // 悬停十字指示：横向虚线贯穿整周（当前列加深）+ 当前列与表头高亮 + 左侧刻度栏时间标签；拖动时跟随
  const hoverLabel = hours.createDiv({ cls: "lubi-week-hover-label", attr: { "aria-hidden": "true" } });
  const hovers: HTMLElement[] = [];
  let dragging = false;
  const yOf = (m: number) => ((m - startH * 60) / 60) * HOUR_PX;
  const showHover = (col: number, m: number, top = yOf(m)) => {
    hovers.forEach((h, i) => {
      h.addClass("is-on");
      h.toggleClass("is-current", i === col);
      h.style.top = `${top}px`;
    });
    cols.forEach((c, i) => c.toggleClass("is-hover", i === col));
    heads.forEach((h, i) => h.toggleClass("is-hover", i === col));
    hoverLabel.style.top = `${top}px`;
    hoverLabel.setText(minToHM(m));
    hoverLabel.addClass("is-on");
  };
  const hideHover = () => {
    hovers.forEach((h) => h.removeClass("is-on", "is-current"));
    cols.forEach((c) => c.removeClass("is-hover"));
    heads.forEach((h) => h.removeClass("is-hover"));
    hoverLabel.removeClass("is-on");
  };
  const cols: HTMLElement[] = [];
  days.forEach((d, dayIdx) => {
    const col = body.createDiv({ cls: `lubi-week-col ${d === todayStr() ? "is-today" : ""}` });
    cols.push(col);
    col.style.height = `${(endH - startH) * HOUR_PX}px`;
    const colHover = col.createDiv({ cls: "lubi-tl-hover lubi-week-hover", attr: { "aria-hidden": "true" } });
    hovers.push(colHover);
    // 拖入任务的落点仍按原有时间网格吸附；普通悬停不做网格取整。
    const minuteAtY = (clientY: number, round = false) => {
      const rect = col.getBoundingClientRect();
      const raw = ((clientY - rect.top) / HOUR_PX) * 60;
      const m = startH * 60 + (round ? snap(raw) : Math.floor(raw / SNAP) * SNAP);
      return Math.max(startH * 60, Math.min(endH * 60 - SNAP, m));
    };
    col.addEventListener("pointermove", (e) => {
      if (dragging || (e.target as HTMLElement).closest(".lubi-wblock")) {
        if (!dragging) hideHover();
        return;
      }
      const rect = col.getBoundingClientRect();
      const height = (endH - startH) * HOUR_PX;
      // Pointer coordinates are viewport pixels; the guide is positioned in local CSS pixels.
      const top = Math.max(0, Math.min(height, (e.clientY - rect.top) * height / (rect.height || height)));
      const minute = Math.min(endH * 60 - 1, startH * 60 + top / HOUR_PX * 60);
      showHover(dayIdx, minute, top);
    });
    col.addEventListener("pointerleave", () => { if (!dragging) hideHover(); });
    // 从左侧清单拖任务进来时，同样提示落点时间
    col.addEventListener("dragover", (e) => {
      if (!e.dataTransfer?.types.includes("text/lubi-task")) return;
      showHover(dayIdx, minuteAtY(e.clientY, true));
    });
    col.addEventListener("dragleave", (e) => { if (!col.contains(e.relatedTarget as Node | null)) hideHover(); });
    col.addEventListener("drop", () => hideHover());
    for (let h = startH; h < endH; h++) {
      const line = col.createDiv({ cls: "lubi-week-line" });
      line.style.top = `${(h - startH) * HOUR_PX}px`;
      const half = col.createDiv({ cls: "lubi-week-line is-half" });
      half.style.top = `${(h - startH + 0.5) * HOUR_PX}px`;
    }
    const endLine = col.createDiv({ cls: "lubi-week-line is-day-end" });
    endLine.style.top = `${(endH - startH) * HOUR_PX}px`;
    if (d === todayStr()) {
      const now = col.createDiv({ cls: "lubi-now" });
      now.style.top = `${((hmToMin(nowHM()) - startH * 60) / 60) * HOUR_PX}px`;
    }
    const items = daily.get(d)!.filter(item => item.timed).map(item => item.task);
    for (const t of items) {
      const startMin = hmToMin(t.start);
      const dur = Math.max(t.estimate || 30, SNAP);
      const block = col.createDiv({ cls: `lubi-wblock ${plugin.tasks.isDoneOn(t, d) ? "is-done" : ""} ${t.blocked ? "is-blocked" : ""}`.trim() });
      const place = (s: number, m: number) => {
        block.style.top = `${((s - startH * 60) / 60) * HOUR_PX}px`;
        block.style.height = `${Math.max((m / 60) * HOUR_PX - 2, 18)}px`;
      };
      place(startMin, dur);
      block.style.setProperty("--chip", categoryTone(s, t.category));
      block.createDiv({ cls: "lubi-wblock-title", text: t.title });
      const timeEl = block.createDiv({ cls: "lubi-wblock-time", text: `${t.start}–${minToHM(startMin + dur)}${t.estimate ? "" : " · 未填预计"}` });
      const handleTop = block.createDiv({ cls: "lubi-block-handle is-top" });
      const handle = block.createDiv({ cls: "lubi-block-handle is-bottom" });
      block.setAttribute("tabindex", "0");
      block.setAttribute("role", "button");
      infoTip(block, t.title, [...(plugin.tasks.projectOf(t) ? [`项目：${plugin.tasks.projectOf(t)!.title}`] : []), `${shortDate(d)} · ${t.start}–${minToHM(startMin + dur)}`, `预计用时：${t.estimate ? fmtDuration(t.estimate) : "未设置（显示按 30 分钟）"}`, plugin.tasks.isDoneOn(t, d) ? "已完成" : "待完成"], t.notes);
      block.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); edit(t, d); }
      });
      const pxPerMin = HOUR_PX / 60;
      const bindDrag = (target: HTMLElement, mode: "move" | "resize-start" | "resize-end") => {
        target.addEventListener("pointerdown", (e) => {
          if (mode !== "move") e.stopPropagation();
          const colWidth = col.getBoundingClientRect().width || 1;
          startDrag(e, {
            mode,
            start: startMin,
            minutes: dur,
            pxPerMin,
            min: startH * 60,
            max: endH * 60,
            minMinutes: SNAP,
            snap: SNAP,
            horizontal: mode === "move" ? { colWidth, minCol: -dayIdx, maxCol: days.length - 1 - dayIdx } : undefined,
            onStart: () => {
              dragging = true;
              block.addClass("is-dragging", mode === "move" ? "is-moving" : "is-resizing");
            },
            onMove: (st) => {
              place(st.start, st.minutes);
              block.style.transform = st.col ? `translateX(calc(${st.col * 100}% + ${st.col * 1}px))` : "";
              timeEl.setText(`${minToHM(st.start)}–${minToHM(st.start + st.minutes)}`);
              cols.forEach((c, i) => c.toggleClass("is-drop", i === dayIdx + st.col && st.col !== 0));
              showHover(dayIdx + (st.col || 0), mode === "resize-end" ? st.start + st.minutes : st.start);
            },
            onEnd: (st) => {
              dragging = false;
              hideHover();
              block.removeClass("is-dragging", "is-moving", "is-resizing");
              block.style.transform = "";
              cols.forEach((c) => c.removeClass("is-drop"));
              if (st === null) {
                place(startMin, dur);
                timeEl.setText(`${t.start}–${minToHM(startMin + dur)}`);
                return;
              }
              if (!st.moved) {
                if (mode === "move") edit(t, d);
                return;
              }
              void (async () => {
                const cur = plugin.tasks.byId(t.id);
                if (!cur) return;
                if (mode === "move") {
                  const nd = days[dayIdx + st.col];
                  if (cur.repeat.kind !== "none" && nd !== d) {
                    new Notice("重复任务不能用拖动换天；请在编辑中调整重复规则"); rerender(); return;
                  }
                  const moved = cur.repeat.kind === "none" ? planDatePatch(cur, nd) : {};
                  if (!moved) { new Notice("排期跨度无效，请在编辑中调整"); rerender(); return; }
                  const patch = { ...moved, start: minToHM(st.start) };
                  await updateScheduleWithUndo(plugin, t.id, patch, `${t.title} → ${nd} ${minToHM(st.start)}`, rerender);
                } else if (mode === "resize-start") {
                  await updateScheduleWithUndo(plugin, t.id, { start: minToHM(st.start), estimate: st.minutes }, `${t.title} → ${minToHM(st.start)}–${minToHM(st.start + st.minutes)}`, rerender);
                } else {
                  await updateScheduleWithUndo(plugin, t.id, { estimate: st.minutes }, `${t.title} 预计 ${fmtDuration(st.minutes)}`, rerender);
                }
              })();
            },
          });
        });
      };
      bindDrag(block, "move");
      bindDrag(handleTop, "resize-start");
      bindDrag(handle, "resize-end");
    }
    // 空白处：按下拖出一段时间 → 松手新建任务，日期 / 开始时间 / 预计时长已填好（与每日页时间轴拖出新记录一致）
    const ghost = col.createDiv({ cls: "lubi-wghost", attr: { "aria-hidden": "true" } });
    const colPxPerMin = HOUR_PX / 60;
    col.addEventListener("pointerdown", (e) => {
      if ((e.target as HTMLElement).closest(".lubi-wblock")) return;
      const rect = col.getBoundingClientRect();
      const raw = startH * 60 + Math.floor((e.clientY - rect.top) / colPxPerMin / SNAP) * SNAP;
      const at = Math.max(startH * 60, Math.min(endH * 60 - SNAP, raw));
      startDrag(e, {
        mode: "create",
        start: at,
        minutes: 0,
        pxPerMin: colPxPerMin,
        min: startH * 60,
        max: endH * 60,
        minMinutes: SNAP,
        snap: SNAP,
        onStart: () => {
          dragging = true;
          ghost.addClass("is-on");
        },
        onMove: (st) => {
          ghost.style.top = `${((st.start - startH * 60) / 60) * HOUR_PX}px`;
          ghost.style.height = `${Math.max((st.minutes / 60) * HOUR_PX - 2, 16)}px`;
          ghost.setText(`${minToHM(st.start)}–${minToHM(st.start + st.minutes)} · ${fmtDuration(st.minutes)}`);
          showHover(dayIdx, st.start + st.minutes);
        },
        onEnd: (st) => {
          dragging = false;
          hideHover();
          ghost.removeClass("is-on");
          if (!st || !st.moved) return;
          new TaskModal(plugin.app, plugin, { defaults: { date: d, start: minToHM(st.start), estimate: st.minutes }, onSaved: rerender }).open();
        },
      });
    });
    col.addEventListener("dblclick", (e) => {
      if ((e.target as HTMLElement).closest(".lubi-wblock")) return;
      const rect = col.getBoundingClientRect();
      const min = startH * 60 + snap(((e.clientY - rect.top) / HOUR_PX) * 60);
      new TaskModal(plugin.app, plugin, { defaults: { date: d, start: minToHM(min), estimate: 60 }, onSaved: rerender }).open();
    });
    bindDrop(plugin, col, d, startH, rerender);
  });
  // 首屏：窗口含今天 = 现在 − 1h；否则 = 最早的定时任务（没有则从头）
  const scrollEl = card.querySelector(".lubi-week-body") as HTMLElement | null;
  const earliest = Math.min(...days.flatMap((d) => daily.get(d)!.filter(item => item.timed).map(item => hmToMin(item.task.start))), Infinity);
  const targetMin = days.includes(todayStr()) ? hmToMin(nowHM()) - 60 : Number.isFinite(earliest) ? earliest - 30 : startH * 60;
  const targetPx = Math.max(0, Math.round(((targetMin - startH * 60) / 60) * HOUR_PX));
  if (scrollEl) scrollEl.dataset.scrollTarget = String(targetPx);
  window.requestAnimationFrame(() => {
    if (scrollEl && !scrollEl.dataset.restored) scrollEl.scrollTop = targetPx;
  });
}

/** 每日负载条：计划（未完成任务的预计时长）/ 可用小时（设置），≥90% 橙、>100% 红（借鉴 Sunsama 的超载提醒） */
function renderLoad(plugin: LubiPlugin, host: HTMLElement, d: string): void {
  const capacity = Math.max(1, plugin.settings.dailyCapacityHours || 8) * 60;
  const planned = plugin.tasks.forDate(d)
    .filter((t) => !plugin.tasks.children(t.id).length && !plugin.tasks.isDoneOn(t, d))
    .reduce((sum, t) => sum + (t.estimate || 0), 0);
  // 没排计划的日子不画空负载条，免得整行都是灰条和“—”
  if (!planned) return;
  const ratio = planned / capacity;
  const level = ratio > 1 ? "is-over" : ratio >= 0.9 ? "is-high" : "is-ok";
  const load = host.createDiv({ cls: `lubi-load ${level}`, attr: {
    role: "meter", "aria-valuemin": "0", "aria-valuemax": String(capacity), "aria-valuenow": String(Math.min(planned, capacity * 2)),
  } });
  infoTip(load, `${shortDate(d)} · 当天负载`, [`已安排：${fmtDuration(planned)}`, `可用时间：${fmtDuration(capacity)}`, `${ratio > 1 ? "超出" : "剩余"}：${fmtDuration(Math.abs(capacity - planned))}`, "统计口径：计划用时，非实际投入"]);
  const track = load.createDiv({ cls: "lubi-load-track" });
  track.createDiv({ cls: "lubi-load-fill" }).style.width = `${Math.min(100, ratio * 100)}%`;
  load.createSpan({ cls: "lubi-load-text", text: `${fmtHoursShort(planned)}/${fmtHoursShort(capacity)}` });
}

function fmtHoursShort(min: number): string {
  const h = Math.round((min / 60) * 10) / 10;
  return `${h}h`;
}

function snap(min: number): number {
  return Math.round(min / SNAP) * SNAP;
}

function bindDrop(plugin: LubiPlugin, target: HTMLElement, date: string, startH: number | null, rerender: () => void, preserveStart = false, onSaved?: () => void): void {
  target.addEventListener("dragover", (e) => {
    if (!e.dataTransfer?.types.includes("text/lubi-task")) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    target.addClass("is-drop");
  });
  target.addEventListener("dragleave", (e) => {
    if (e.relatedTarget instanceof Node && target.contains(e.relatedTarget)) return;
    target.removeClass("is-drop");
  });
  target.addEventListener("drop", async (e) => {
    target.removeClass("is-drop");
    const id = e.dataTransfer?.getData("text/lubi-task");
    if (!id) return;
    e.preventDefault();
    // 同一清单空白处落下不应把已有时间清掉。
    if (target.classList.contains("lubi-list-card") && Array.from(target.querySelectorAll<HTMLElement>("[data-task-id]")).some(el => el.dataset.taskId === id)) return;
    let start = "";
    if (startH !== null) {
      const rect = target.getBoundingClientRect();
      start = minToHM(Math.max(0, Math.min(1440 - SNAP, startH * 60 + snap(target.classList.contains("lubi-tl-canvas") && rect.height > 0 ? (e.clientY - rect.top) / rect.height * 1440 : ((e.clientY - rect.top) / HOUR_PX) * 60))));
    }
    const task = plugin.tasks.byId(id);
    if (!task) return;
    if (task.repeat.kind !== "none") { new Notice("重复任务请在编辑中调整规则或时间"); return; }
    const moved = planDatePatch(task, date, e.dataTransfer?.getData("text/lubi-task-date") || undefined);
    if (!moved) { new Notice("排期跨度无效，请在编辑中调整"); return; }
    if (preserveStart) start = task.start;
    await updateScheduleWithUndo(plugin, id, { ...moved, start }, `${task.title} → ${date}${start ? ` ${start}` : " 全天"}`, rerender, onSaved);
  });
}
