import { categoryTone } from "./monochrome";
import { Notice } from "obsidian";
import type LubiPlugin from "../main";
import { dailyGanttRows } from "../core/gantt";
import { Task } from "../core/tasks";
import { fmtDuration, minToHM } from "../core/time";
import { categoryOf } from "../settings";
import { button, catDot, infoTip, stopAll } from "./components";
import { ganttShell, projectRows, projectHeading } from "./gantt";
import { fitGanttLabel, updateGanttNow } from "./ganttLabels";
import { startDrag, DragMode } from "./drag";

export function renderDailyGantt(plugin: LubiPlugin, card: HTMLElement, date: string, rerender: () => void, edit: (task: Task) => void, save: (id: string, patch: Partial<Pick<Task, "start" | "estimate">>, message: string) => Promise<void>): void {
  const { table, header } = ganttShell(card, `${date} 的时间甘特图，第一行是 00:00 至 24:00 时间线`, true);
  table.dataset.ganttFrom = date; table.dataset.ganttCount = "1";
  const axis = header.createDiv({ cls: "lubi-daily-gantt-axis", attr: { role: "columnheader" } });
  for (let hour = 0; hour <= 24; hour++) {
    const tick = axis.createDiv({ cls: "lubi-daily-gantt-tick", text: `${String(hour).padStart(2, "0")}:00`, attr: { "data-hour": String(hour) } });
    tick.style.left = `calc(${hour / 24 * 100}% + ${20 - 40 * hour / 24}px)`;
  }
  const rows = dailyGanttRows(plugin.tasks.all, date);
  if (!rows.length) { table.createDiv({ cls: "lubi-gantt-empty lubi-muted", text: "这一天没有已安排的规划任务", attr: { role: "status" } }); return; }
  const untimed = rows.filter(row => row.start === null);
  if (untimed.length) {
    const strip = card.createDiv({ cls: "lubi-daily-unset" });
    strip.createSpan({ cls: "lubi-daily-unset-label", text: `未定时（${untimed.length}）` });
    for (const row of untimed) {
      const chip = strip.createEl("button", { cls: "lubi-daily-unset-chip", text: row.task.title, attr: { type: "button" } });
      chip.addEventListener("click", () => { const current = plugin.tasks.byId(row.task.id); if (current) edit(current); else { new Notice("任务已不存在", 5000); rerender(); } });
    }
    table.parentElement?.before(strip);
  }
  const timedRows = rows.filter(row => row.start !== null);
  if (!timedRows.length) { table.createDiv({ cls: "lubi-gantt-empty lubi-muted", text: "这一天没有已定时的规划任务", attr: { role: "status" } }); return; }
  for (const group of projectRows(plugin, timedRows)) {
    const groupHost = projectHeading(table, group);
    for (const row of group.rows) {
    const task = row.task;
    const open = () => { const current = plugin.tasks.byId(task.id); if (current) edit(current); else { new Notice("任务已不存在", 5000); rerender(); } };
    const line = groupHost.createDiv({ cls: "lubi-gantt-row", attr: { role: "row", "data-task-id": task.id } });
    line.style.setProperty("--chip", categoryTone(plugin.settings, task.category));
    line.toggleClass("is-done", row.done);
    const name = line.createDiv({ cls: "lubi-gantt-name", attr: { role: "rowheader" } });
    name.style.setProperty("--gantt-indent", "8px");
    catDot(name, categoryOf(plugin.settings, task.category));
    button(name, task.title, open, { cls: "lubi-gantt-title" });
    const track = line.createDiv({ cls: "lubi-gantt-track", attr: { role: "cell" } });
    const plot = track.createDiv({ cls: "lubi-daily-gantt-plot" });
    const grid = plot.createDiv({ cls: "lubi-gantt-grid", attr: { "aria-hidden": "true" } });
    for (let hour = 0; hour < 24; hour++) grid.createDiv();
    plot.createDiv({ cls: "lubi-gantt-today", attr: { "aria-hidden": "true" } });
    const bar = plot.createDiv({ cls: "lubi-gantt-bar", attr: { role: "button", tabindex: "0", "data-start": String(row.start), "data-minutes": String(row.minutes) } });
    bar.toggleClass("is-done", row.done); bar.toggleClass("is-point", row.minutes === 0);
    const label = bar.createSpan({ cls: "lubi-gantt-bar-label" });
    const place = (start: number, minutes: number) => {
      bar.style.left = `${start / 1440 * 100}%`;
      bar.style.width = minutes ? `${Math.min(minutes, 1440 - start) / 1440 * 100}%` : "6px";
      label.setText(minutes > 0 ? fmtDuration(minutes) : "未填预计");
      fitGanttLabel(bar);
    };
    place(row.start!, row.minutes);
    const end = row.start! + row.minutes;
    const endText = end === 1440 ? "24:00" : `${end > 1440 ? `+${Math.floor(end / 1440)} 天 ` : ""}${minToHM(end)}`;
    infoTip(bar, task.title, [date, row.minutes ? `${task.start}–${endText} · 预计 ${fmtDuration(row.minutes)}` : `${task.start} · 未填预计`, row.done ? "已完成" : "未完成", ...(end > 1440 ? ["跨午夜计划，仅展示本日部分"] : []), ...(task.repeat.kind !== "none" ? ["重复任务"] : [])], task.notes);
    let suppressClick = false;
    bar.addEventListener("click", e => { stopAll(e); if ((e.target as HTMLElement).closest(".lubi-gantt-handle")) return; if (suppressClick && e.detail > 0) { suppressClick = false; return; } open(); });
    bar.addEventListener("keydown", e => { if (e.target === bar && ["Enter", " "].includes(e.key)) { stopAll(e); open(); } });
    // A clipped duration or repeat occurrence must not silently become a different plan.
    const editable = task.repeat.kind === "none" && end <= 1440 && row.minutes < 1440;
    bar.toggleClass("is-editable", editable);
    if (!editable) continue;
    const bind = (target: HTMLElement, mode: DragMode) => target.addEventListener("pointerdown", e => {
      if (e.button !== 0 || (mode === "move" && (e.target as HTMLElement).closest(".lubi-gantt-handle"))) return;
      e.stopPropagation();
      const current = plugin.tasks.byId(task.id); if (!current) return;
      const snapshot = { ...current }, width = plot.getBoundingClientRect().width;
      if (width <= 0) return;
      startDrag(e, {
        axis: "x", mode, start: row.start!, minutes: row.minutes || 1, pxPerMin: width / 1440,
        min: 0, max: 1440, minMinutes: 5, snap: 5,
        onStart: () => { suppressClick = true; bar.addClass("is-dragging"); },
        onMove: state => place(state.start, row.minutes ? state.minutes : 0),
        onEnd: state => {
          bar.removeClass("is-dragging");
          if (!state || !state.moved || !bar.isConnected) { place(row.start!, row.minutes); return; }
          const latest = plugin.tasks.byId(task.id);
          if (!latest || latest.date !== snapshot.date || latest.start !== snapshot.start || latest.estimate !== snapshot.estimate || JSON.stringify(latest.repeat) !== JSON.stringify(snapshot.repeat)) {
            place(row.start!, row.minutes); new Notice("任务排期已改变，本次拖动未保存。", 5000); rerender(); return;
          }
          const patch: Partial<Pick<Task, "start" | "estimate">> = {};
          if (minToHM(state.start) !== snapshot.start) patch.start = minToHM(state.start);
          if (mode !== "move" && state.minutes !== snapshot.estimate) patch.estimate = state.minutes;
          if (!Object.keys(patch).length) { place(row.start!, row.minutes); return; }
          void save(task.id, patch, `${latest.title} → ${minToHM(state.start)}${row.minutes ? ` · 预计 ${fmtDuration(state.minutes)}` : ""}`);
        },
      });
    });
    bind(bar, "move");
    if (row.minutes >= 5) for (const mode of ["resize-start", "resize-end"] as const) {
      const handle = bar.createDiv({ cls: `lubi-gantt-handle is-${mode === "resize-start" ? "start" : "end"}`, attr: { "aria-hidden": "true" } });
      handle.addEventListener("click", stopAll); bind(handle, mode);
    }
  }
  }
  updateGanttNow(table);
}
