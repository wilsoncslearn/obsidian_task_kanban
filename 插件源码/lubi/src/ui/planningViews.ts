import { categoryTone } from "./monochrome";
import type LubiPlugin from "../main";
import { Task } from "../core/tasks";
import { monthCalendarDays, planOccurrences } from "../core/planning";
import { fmtDuration, shortDate, todayStr, weekdayZh } from "../core/time";
import { categoryOf } from "../settings";
import { catDot, infoTip } from "./components";
import { taskRow } from "./taskList";
import { openUnifiedRecord } from "./modals";

type Edit = (task: Task, date?: string) => void;
type Decorate = (element: HTMLElement, task: Task) => void;
let monthLabelId = 0;

type Drop = (element: HTMLElement, date: string) => void;

export function renderMonthCalendar(plugin: LubiPlugin, card: HTMLElement, selected: string, edit: Edit, decorate: Decorate, drop: Drop): void {
  const scroll = card.createDiv({ cls: "lubi-month-scroll" });
  const grid = scroll.createDiv({ cls: "lubi-month-calendar" });
  for (const day of ["一", "二", "三", "四", "五", "六", "日"]) grid.createDiv({ cls: "lubi-month-weekday", text: `周${day}` });
  for (const date of monthCalendarDays(selected)) {
    const inMonth = date.slice(0, 7) === selected.slice(0, 7);
    const cell = grid.createDiv({ cls: `lubi-month-day ${inMonth ? "" : "is-outside"} ${date === todayStr() ? "is-today" : ""} ${date === selected ? "is-selected" : ""}`.trim(), attr: { "data-date": date } });
    const heading = cell.createEl("button", { cls: "lubi-month-date", text: String(Number(date.slice(8))), attr: { type: "button", "aria-current": date === selected ? "date" : "false", "data-lubi-focus": `plan-date:${date}` } });
    const label = cell.createSpan({ cls: "lubi-sr-only", text: `查看 ${date} 周${weekdayZh(date)} 的任务`, attr: { id: `lubi-month-date-${++monthLabelId}` } });
    heading.setAttribute("aria-labelledby", label.id);
    heading.addEventListener("click", () => plugin.openDate(date, "tasks"));
    drop(cell, date);
    if (!inMonth) continue;
    for (const occurrence of planOccurrences(plugin.tasks.all, [date])) {
      const task = occurrence.task;
      const chip = cell.createEl("button", { cls: `lubi-month-task ${occurrence.done ? "is-done" : ""}`, attr: { type: "button", "data-task-id": task.id, "data-date": date } });
      chip.style.setProperty("--chip", categoryTone(plugin.settings, task.category));
      catDot(chip, categoryOf(plugin.settings, task.category));
      if (occurrence.timed) chip.createSpan({ cls: "lubi-month-task-time", text: task.start });
      chip.createSpan({ cls: "lubi-month-task-title", text: task.title });
      infoTip(chip, task.title, [...(plugin.tasks.projectOf(task) ? [`项目：${plugin.tasks.projectOf(task)!.title}`] : []), occurrence.from === occurrence.to ? date : `${occurrence.from} – ${occurrence.to}`,
        ...(occurrence.timed ? [`开始：${task.start}`] : []), `预计用时：${task.estimate ? fmtDuration(task.estimate) : "未设置"}`,
        occurrence.done ? "已完成" : "待完成"], task.notes);
      chip.addEventListener("click", event => { event.stopPropagation(); edit(task, date); });
      decorate(chip, task);
    }
  }
}

export function renderRangeList(plugin: LubiPlugin, card: HTMLElement, days: string[], rerender: () => void, edit: Edit, decorate: Decorate, drop: Drop): void {
  const items = planOccurrences(plugin.tasks.all, days);

  const groups = new Map<string, typeof items>();
  for (const item of items) { const list = groups.get(item.date) || []; list.push(item); groups.set(item.date, list); }
  const host = card.createDiv({ cls: "lubi-plan-range-list" });
  if (!items.length) {
    host.createEl("h3", { cls: "lubi-plan-list-date", text: days.length === 1 ? days[0] : `${days[0]} – ${days[days.length - 1]}` });
    const empty = host.createDiv({ cls: "lubi-plan-list-empty lubi-muted", text: "暂无安排", attr: { role: "status" } });
    drop(empty, days[0]);
  }
  for (const [date, occurrences] of groups) {
    const section = host.createDiv({ cls: "lubi-plan-date-group", attr: { "data-date": date } });
    const heading = section.createEl("button", { cls: "lubi-plan-list-date", text: `${shortDate(date)} 周${weekdayZh(date)}${date === todayStr() ? " · 今天" : ""}`, attr: { type: "button", "data-lubi-focus": `plan-date:${date}` } });
    heading.addEventListener("click", () => plugin.openDate(date, "tasks"));
    drop(section, date);
    for (const occurrence of occurrences) {
      const task = occurrence.task;
      const span = occurrence.from !== occurrence.to ? `${shortDate(occurrence.from)} – ${shortDate(occurrence.to)}` : undefined;
      const row = taskRow(plugin, section, task, date, rerender,
        (defaults, onRec) => openUnifiedRecord(plugin, date, defaults, async rec => { if (rec && onRec) await onRec(rec); rerender(); }),
        () => edit(task, date), { compact: true, span, timed: occurrence.timed });
      row.dataset.date = date;
      decorate(row, task);
      const path = plugin.tasks.projectOf(task)?.title || plugin.tasks.pathOf(task).slice(0, -1).map(parent => parent.title).join(" / ");
      if (path) row.querySelector(".lubi-task-body")?.createSpan({ cls: "lubi-plan-list-parent lubi-muted", text: path });
    }
  }
}
