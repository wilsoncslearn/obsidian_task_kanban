import { categoryTone } from "./monochrome";
// 计划日历日视图的分类分布与计划进度卡片。
import type LubiPlugin from "../main";
import { PENDING_KEY, Rec } from "../core/records";
import { fmtHours, shortDate, todayStr } from "../core/time";
import { dayTimeStats } from "../core/metrics";
import { categoryOf } from "../settings";
import { catDot, donut, el } from "./components";

/** 统计与清单共用同一批当天任务；具体任务行及拖拽由调用方提供。 */
export function renderDayPlan(side: HTMLElement, date: string, total: number, done: number, renderList: (list: HTMLElement) => void): HTMLElement {
  const card = side.createDiv({ cls: "lubi-card lubi-section lubi-plan-card" });
  const head = card.createDiv({ cls: "lubi-panel-head" });
  el(head, "h3", "lubi-panel-title", date === todayStr() ? "今日计划" : "当天计划");
  head.createSpan({ cls: "lubi-muted", text: `${done}/${total} 已做` });
  const progress = card.createDiv({ cls: "lubi-plan-progress", attr: { role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(total || 1), "aria-valuenow": String(done), "aria-valuetext": `${done}/${total} 已完成`, "aria-label": "计划完成度（已完成）" } });
  progress.createDiv({ cls: "lubi-plan-progress-fill" }).style.width = `${total ? Math.round(done / total * 100) : 0}%`;
  const details = card.createEl("details", { cls: "lubi-fold lubi-plan-task-details" });
  details.open = true;
  details.createEl("summary", { text: "任务清单", attr: { "data-lubi-focus": "plan-task-details" } });
  const list = details.createDiv({ cls: "lubi-task-list lubi-plan-task-list" });
  if (!total) list.createDiv({ cls: "lubi-muted lubi-pad", text: "暂无安排" });
  renderList(list);
  return card;
}

export function renderDayDistribution(plugin: LubiPlugin, side: HTMLElement, recs: Rec[], date: string): void {
  const card = side.createDiv({ cls: "lubi-card lubi-section lubi-distribution" });
  el(card, "h3", "lubi-panel-title", date === todayStr() ? "分类分布" : `${shortDate(date)} 分布`);
  const byCat = new Map<string, number>();
  let total = 0;
  for (const r of recs) {
    if (r.minutes <= 0) continue;
    byCat.set(r.category, (byCat.get(r.category) || 0) + r.minutes);
    total += r.minutes;
  }
  const wrap = card.createDiv({ cls: "lubi-donut-wrap" });
  const slices = [...byCat.entries()].sort((a, b) => b[1] - a[1]).map(([name, v]) => ({ label: name, value: v, color: categoryTone(plugin.settings, name) }));
  const covered = dayTimeStats(recs).coveredMinutes;
  donut(wrap, slices, fmtHours(total), recs.some(r => r.extra[PENDING_KEY] === "实际开始未核对") ? "覆盖待核对" : `覆盖 ${Math.round((covered / 1440) * 100)}%`);
  const list = wrap.createDiv({ cls: "lubi-legend" });
  if (!slices.length) list.createDiv({ cls: "lubi-muted", text: "暂无记录" });
  for (const s of slices) {
    const li = list.createDiv({ cls: "lubi-legend-row lubi-legend-bar" });
    li.style.setProperty("--pct", `${Math.round((s.value / total) * 100)}%`);
    li.style.setProperty("--dot", s.color);
    catDot(li, categoryOf(plugin.settings, s.label), s.color);
    li.createSpan({ cls: "lubi-legend-name", text: s.label });
    li.createSpan({ cls: "lubi-legend-val", text: fmtHours(s.value) });
    li.createSpan({ cls: "lubi-muted lubi-legend-pct", text: `${Math.round((s.value / total) * 100)}%` });
  }
  const spend = recs.filter((r) => r.amount !== undefined && !isNaN(r.amount));
  if (spend.length) {
    const sum = spend.reduce((s, r) => s + (r.amount || 0), 0);
    const row = card.createDiv({ cls: "lubi-kv" });
    row.createSpan({ text: date === todayStr() ? "今日支出" : `${shortDate(date)} 支出` });
    row.createSpan({ cls: "lubi-kv-val", text: `¥${sum.toFixed(2)} · ${spend.length} 笔` });
  }
}
