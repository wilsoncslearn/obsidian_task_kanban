import { categoryTone } from "./monochrome";
import { Notice } from "obsidian";
import type LubiPlugin from "../main";
import { explicitSpan, GanttAction, ganttPatch, GanttPatch, ganttRows, GanttSegment } from "../core/gantt";
import { Task } from "../core/tasks";
import { daysBetween, fmtDuration, isValidDate, shortDate, todayStr, weekdayZh } from "../core/time";
import { categoryOf } from "../settings";
import { button, catDot, iconButton, infoTip, stopAll } from "./components";
import { startDrag } from "./drag";
import { fitGanttLabel, updateGanttNow } from "./ganttLabels";

let descriptionId = 0;

export function ganttShell(card: HTMLElement, text: string, daily = false): { table: HTMLElement; header: HTMLElement } {
  const description = card.createSpan({ cls: "lubi-sr-only", text, attr: { id: `lubi-gantt-description-${++descriptionId}` } });
  const scroller = card.createDiv({ cls: `lubi-gantt-scroll ${daily ? "lubi-daily-gantt-scroll" : ""}`, attr: { tabindex: "0", role: "region", "aria-labelledby": description.id } });
  const table = scroller.createDiv({ cls: "lubi-gantt-table", attr: { role: "table", "aria-labelledby": description.id } });
  const header = table.createDiv({ cls: "lubi-gantt-heading", attr: { role: "row" } });
  header.createDiv({ cls: "lubi-gantt-project-column", text: "项目", attr: { role: "columnheader" } });
  header.createDiv({ cls: "lubi-gantt-name", text: "任务", attr: { role: "columnheader" } });
  return { table, header };
}

/** Project headings are not tasks: no task IDs, bars, completion or drag handlers. */
export function projectRows<T extends { task: Task }>(plugin: LubiPlugin, rows: T[]): { title: string; id: string; rows: T[] }[] {
  const groups = new Map<string, { title: string; id: string; rows: T[] }>();
  for (const row of rows) { const project = plugin.tasks.projectOf(row.task); const id = project?.id || "";
    if (!groups.has(id)) groups.set(id, { title: project?.title || "独立任务", id, rows: [] });groups.get(id)!.rows.push(row);
  }
  return [...groups.values()];
}
export function projectHeading(table: HTMLElement, group: { title: string; id: string }): HTMLElement {
  const container = table.createDiv({ cls: "lubi-gantt-project-group", attr: { role: "rowgroup", "aria-label": group.title } });
  const label = container.createDiv({ cls: "lubi-gantt-project-heading", attr: { role: "rowheader", "data-project-id": group.id } });
  label.createDiv({ cls: "lubi-gantt-name", text: group.title });
  return container.createDiv({ cls: "lubi-gantt-project-tasks" });
}

export function renderGantt(plugin: LubiPlugin, card: HTMLElement, days: string[], collapsed: Set<string>, rerender: () => void, edit: (t: Task, date?: string) => void, save: (id: string, patch: GanttPatch, message: string) => Promise<void>): void {
  const rows = ganttRows(plugin.tasks.all, days, collapsed);
  const count = days.length;
  const { table, header } = ganttShell(card, "规划任务甘特图，可横向滚动");
  table.style.setProperty("--gantt-count", String(count));
  table.dataset.days = String(count);
  table.dataset.ganttFrom = days[0]; table.dataset.ganttCount = String(count);
  const dates = header.createDiv({ cls: "lubi-gantt-dates" });
  for (const day of days) {
    const cell = button(dates, `${shortDate(day)} 周${weekdayZh(day)}`, () => plugin.openDate(day, "tasks"), { cls: "lubi-gantt-date" });
    cell.dataset.date = day; cell.setAttribute("role", "columnheader");
    if (day === todayStr()) { cell.addClass("is-today"); cell.setAttribute("aria-current", "date"); }
  }
  if (!rows.length) {
    const empty = table.createDiv({ cls: "lubi-gantt-empty lubi-muted", text: "这个时段没有已安排的规划任务" });
    empty.setAttribute("role", "status");
    return;
  }
  const first = days[0], last = days[days.length - 1];
  for (const group of projectRows(plugin, rows)) {
    const groupHost = projectHeading(table, group);
    for (const row of group.rows) {
    const t = row.task;
    const openTask = () => {
      const current = plugin.tasks.byId(t.id);
      if (!current) { new Notice("任务已不存在", 5000); rerender(); return; }
      edit(current);
    };
    const line = groupHost.createDiv({ cls: "lubi-gantt-row", attr: { role: "row", "data-task-id": t.id } });
    line.toggleClass("is-done", t.repeat.kind === "none" && t.status === "done");
    line.style.setProperty("--chip", categoryTone(plugin.settings, t.category));
    const name = line.createDiv({ cls: "lubi-gantt-name", attr: { role: "rowheader" } });
    name.style.setProperty("--gantt-indent", `${8 + Math.min(row.depth, 3) * 10}px`);
    if (row.hasChildren) {
      const toggle = iconButton(name, collapsed.has(t.id) ? "chevron-right" : "chevron-down", `${collapsed.has(t.id) ? "展开" : "收起"}${t.title}的子任务`, () => {
        if (collapsed.has(t.id)) collapsed.delete(t.id); else collapsed.add(t.id); rerender();
      }, "lubi-gantt-collapse");
      toggle.setAttribute("aria-expanded", String(!collapsed.has(t.id)));
    } else if (row.depth > 0) name.createSpan({ cls: "lubi-gantt-spacer", attr: { "aria-hidden": "true" } });
    catDot(name, categoryOf(plugin.settings, t.category));
    button(name, t.title, openTask, { cls: "lubi-gantt-title" });
    const track = line.createDiv({ cls: "lubi-gantt-track", attr: { role: "cell" } });
    const grid = track.createDiv({ cls: "lubi-gantt-grid", attr: { "aria-hidden": "true" } });
    for (const day of days) grid.createDiv({ cls: `${["六", "日"].includes(weekdayZh(day)) ? "is-weekend" : ""}`, attr: { "data-date": day } });
    track.createDiv({ cls: "lubi-gantt-today", attr: { "aria-hidden": "true" } });
    for (const segment of row.segments) {
      const bar = track.createDiv({ cls: "lubi-gantt-bar", attr: { role: "button", tabindex: "0", "data-from": segment.from, "data-to": segment.to } });
      bar.toggleClass("is-done", segment.done); bar.toggleClass("is-summary", row.summary);
      const span = explicitSpan(t);
      const validScheduled = span ? !t.date || (isValidDate(t.date) && t.date >= span.from && t.date <= span.to) : isValidDate(t.date) && !t.startDate && !t.endDate;
      const editable = !row.summary && t.repeat.kind === "none" && validScheduled;
      bar.toggleClass("is-editable", editable);
      const label = bar.createSpan({ cls: "lubi-gantt-bar-label" });
      const place = (range: GanttSegment) => {
        const a = Math.max(0, Math.min(count - 1, daysBetween(first, range.from)));
        const b = Math.max(a, Math.min(count - 1, daysBetween(first, range.to)));
        bar.style.left = `calc(${a / count * 100}% + 2px)`;
        bar.style.width = `calc(${(b - a + 1) / count * 100}% - 4px)`;
        const outside = range.to < first || range.from > last;
        const text = range.from === range.to ? (t.estimate > 0 ? fmtDuration(t.estimate) : "未填预计") : `${shortDate(range.from)}–${shortDate(range.to)}`;
        label.setText(`${outside ? "窗口外 · " : ""}${text}`);
        fitGanttLabel(bar);
      };
      place(segment);
      infoTip(bar, t.title, [...(plugin.tasks.projectOf(t) ? [`项目：${plugin.tasks.projectOf(t)!.title}`] : []), `预计用时：${t.estimate ? fmtDuration(t.estimate) : "未设置"}`, `${segment.from}${segment.from !== segment.to ? ` – ${segment.to}` : ""}`, segment.done ? "已完成" : "未完成", ...(row.summary ? ["子任务日期汇总"] : []), ...(t.repeat.kind !== "none" ? ["重复任务 · 日期分段"] : [])], t.notes);
      let suppressClick = false;
      const open = () => { const current = plugin.tasks.byId(t.id); if (current) edit(current, segment.from); else { new Notice("任务已不存在", 5000); rerender(); } };
      bar.addEventListener("click", e => {
        stopAll(e);
        if ((e.target as HTMLElement).closest(".lubi-gantt-handle")) return;
        if (suppressClick && e.detail > 0) { suppressClick = false; return; }
        open();
      });
      bar.addEventListener("keydown", e => {
        if (e.target === bar && ["Enter", " "].includes(e.key)) { stopAll(e); open(); }
      });
      if (!editable) continue;
      const bind = (target: HTMLElement, action: GanttAction) => target.addEventListener("pointerdown", e => {
        if (action === "move" && (e.target as HTMLElement).closest(".lubi-gantt-handle")) return;
        if (e.button !== 0) return;
        e.stopPropagation();
        const initial = plugin.tasks.byId(t.id); if (!initial) return;
        const snapshot = { ...initial };
        const width = track.getBoundingClientRect().width / count;
        if (width <= 0) return;
        let preview = segment;
        startDrag(e, {
          mode: "move", start: 0, minutes: 1, pxPerMin: 1, min: 0, max: 1, snap: 1,
          horizontal: { colWidth: width, minCol: -28000, maxCol: 28000 },
          onStart: () => { suppressClick = true; bar.addClass("is-dragging"); },
          onMove: state => {
            const patch = ganttPatch(snapshot, action, state.col);
            if (!patch) return;
            const changed = { ...snapshot, ...patch };
            const range = explicitSpan(changed);
            preview = { from: range?.from || changed.date, to: range?.to || changed.date, done: segment.done };
            place(preview);
          },
          onEnd: state => {
            bar.removeClass("is-dragging");
            if (!state || !state.moved || !bar.isConnected) { place(segment); return; }
            const latest = plugin.tasks.byId(t.id);
            if (!latest || latest.date !== snapshot.date || latest.startDate !== snapshot.startDate || latest.endDate !== snapshot.endDate || JSON.stringify(latest.repeat) !== JSON.stringify(snapshot.repeat)) {
              place(segment); new Notice("任务排期已改变，本次拖动未保存。", 5000); rerender(); return;
            }
            const patch = ganttPatch(snapshot, action, state.col);
            if (!patch || !Object.keys(patch).length) { place(segment); return; }
            void save(t.id, patch, `${latest.title} → ${preview.from}${preview.to !== preview.from ? `–${preview.to}` : ""}`);
          },
        });
      });
      bind(bar, "move");
      for (const action of ["start", "end"] as const) {
        const clipped = action === "start" ? segment.from < first : segment.to > last;
        if (clipped) continue; // Do not pretend a clipped window edge is the actual task boundary.
        const handle = bar.createDiv({ cls: `lubi-gantt-handle is-${action}`, attr: { "aria-hidden": "true" } });
        handle.addEventListener("click", stopAll); bind(handle, action);
      }
    }
  }
  }
  updateGanttNow(table);
}
