import { categoryTone } from "./monochrome";
// 回顾页：周 / 月 / 年 汇总。柳比歇夫法的核心是"月末算账"。

import type LubiPlugin from "../main";
import { isPending, PENDING_KEY, Rec } from "../core/records";
import { eachDate, fmtDuration, fmtHours, hmToMin, minToHM, monthEnd, monthStart, parseDate, shiftDate, shortDate, weekStart, weekdayZh, todayStr, dateStr } from "../core/time";
import { categoryOf } from "../settings";
import { dayTimeStats } from "../core/metrics";
import type { Task } from "../core/tasks";
import { button, catDot, el, hoverTip, icon, iconButton, segmented, tip } from "./components";

export type Period = "week" | "month" | "year";

export interface ReviewState {
  period: Period;
  anchor: string; // 任一日期，用于定位周期
  display?: "chart" | "table";
}

interface Bucket {
  key: string;
  label: string;
  dates: string[];
}

export async function renderReview(plugin: LubiPlugin, host: HTMLElement, state: ReviewState, setState: (s: Partial<ReviewState>) => void): Promise<void> {
  host.empty();
  host.addClass("lubi-review");
  const { from, to, label, buckets } = range(state);

  // 工具条
  const bar = host.createDiv({ cls: "lubi-toolbar" });
  segmented<Period>(bar, [
    { id: "week", label: "周" },
    { id: "month", label: "月" },
    { id: "year", label: "年" },
  ], state.period, (p) => setState({ period: p }));
  const nav = bar.createDiv({ cls: "lubi-nav" });
  iconButton(nav, "chevron-left", "上一个", () => setState({ anchor: step(state, -1) }));
  nav.createSpan({ cls: "lubi-nav-label lubi-sr-only", text: label });
  iconButton(nav, "chevron-right", "下一个", () => setState({ anchor: step(state, 1) }));
  const todayBtn = nav.createEl("button", { cls: "lubi-btn lubi-btn-sm", text: "本期" });
  todayBtn.addEventListener("click", () => setState({ anchor: todayStr() }));

  const existing = new Set(plugin.journal.dates());
  const dates = eachDate(from, to).filter((d) => existing.has(d));
  const data = await plugin.journal.readRange(dates);
  const all: Rec[] = [];
  for (const recs of data.values()) all.push(...recs);
  const timed = all.filter((r) => r.minutes > 0);
  const total = timed.reduce((s, r) => s + r.minutes, 0);
  const unknownStartDates = new Set(timed.filter(r => r.extra[PENDING_KEY] === "实际开始未核对").map(r => r.date));
  const dailyStats = new Map([...data].map(([date, recs]) => [date, dayTimeStats(recs)] as const));
  const invalidDates = [...dailyStats].filter(([, stats]) => stats.invalidCount).map(([date]) => date).sort();

  const isEmpty = !timed.length && !all.length;

  // 上一期（用于环比与趋势说明）
  const previous = range({ period: state.period, anchor: step(state, -1) });
  const oldDates = eachDate(previous.from, previous.to).filter((date) => existing.has(date));
  const oldData = await plugin.journal.readRange(oldDates);
  const oldTimed = [...oldData.values()].flat().filter((rec) => rec.minutes > 0);
  const oldDays = new Set(oldTimed.map((rec) => rec.date)).size;
  const oldInvalid = [...oldData.values()].some((recs) => dayTimeStats(recs).invalidCount);
  const oldTotal = oldTimed.reduce((sum, rec) => sum + rec.minutes, 0);

  // 一组摘要展示核心指标，不再为每个数字单独建卡。
  const daysLogged = new Set(timed.map((r) => r.date)).size;
  const spend = all.filter((r) => r.amount !== undefined && !isNaN(r.amount));
  const kpis = host.createDiv({ cls: "lubi-card lubi-kpis lubi-kpis-v2" });
  const primary = kpi(kpis, "记录总时长", fmtHours(total), undefined, "is-primary");
  primary.setAttribute("tabindex", "0");
  tip(primary, "所有时间记录之和，并行记录会重复计入，待确认时长核对前仍是估计。");
  const minDays = state.period === "week" ? 2 : state.period === "month" ? 5 : 14;
  if (!invalidDates.length && !oldInvalid && oldTotal > 0 && daysLogged >= minDays && oldDays >= minDays) {
    const pct = Math.round(((total - oldTotal) / oldTotal) * 100);
    const delta = primary.createDiv({ cls: `lubi-kpi-delta ${pct >= 0 ? "is-up" : "is-down"}` });
    delta.createSpan({ text: `${pct >= 0 ? "↑" : "↓"} ${Math.abs(pct)}%` });
    delta.createSpan({ cls: "lubi-muted", text: ` 较上一期 ${fmtHours(oldTotal)}` });
  } else if (invalidDates.length || oldInvalid) {
    primary.createDiv({ cls: "lubi-muted lubi-kpi-sub", text: "有异常记录，暂不做环比" });
  } else {
    tip(primary, "上一期记录不足，暂不做环比；记录总时长包含并行记录及待确认时长。");
  }
  // 按计划自动记下、还没核对的记录：时长是估计值，单独提示，避免把「计划」当成「实际」
  const pendingRecs = timed.filter((r) => isPending(r));
  if (pendingRecs.length) {
    const pm = pendingRecs.reduce((sum, r) => sum + r.minutes, 0);
    const note = primary.createDiv({ cls: "lubi-kpi-pending" });
    const startPending = pendingRecs.filter(r => r.extra[PENDING_KEY] === "实际开始未核对");
    const startMinutes = startPending.reduce((sum, r) => sum + r.minutes, 0);
    const parts = [pm > startMinutes ? `${fmtHours(pm - startMinutes)} 按计划估计` : "", startMinutes ? `${fmtHours(startMinutes)} 实际开始待核对` : ""].filter(Boolean);
    note.setText(`其中 ${parts.join("；")} · ${pendingRecs.length} 条待确认`);
    tip(note, "这些记录的开始或时长仍需核对；在时间轴编辑或确认后解除待确认标记。");
  }
  const secondary = kpis.createDiv({ cls: "lubi-kpi-grid" });
  const coveredTotal = [...dailyStats.values()].reduce((sum2, stats) => sum2 + stats.coveredMinutes, 0);
  const overlapTotal = Math.max(0, total - coveredTotal);
  kpi(secondary, "实际覆盖", unknownStartDates.size ? "—" : fmtHours(coveredTotal), "每天重叠区间合并后的覆盖时间");
  if (invalidDates.length) {
    const validDays = [...dailyStats].filter(([, st]) => !st.invalidCount && st.recordedMinutes > 0);
    const validAvg = validDays.length ? validDays.reduce((sum2, [, st]) => sum2 + st.recordedMinutes, 0) / validDays.length : 0;
    kpi(secondary, "有效日均", validDays.length ? fmtHours(validAvg) : "—", `剔除 ${invalidDates.length} 个待校对异常日后计算`);
  } else {
    kpi(secondary, "日均记录", daysLogged ? fmtHours(total / daysLogged) : "—", "有记录的天");
  }
  kpi(secondary, "有记录的天数", `${daysLogged} / ${eachDate(from, to).filter((d) => d <= todayStr()).length}`);
  if (overlapTotal) kpi(secondary, "并行重叠", fmtHours(overlapTotal), "并行记录的重复时长");
  kpi(secondary, "覆盖率", !unknownStartDates.size && daysLogged ? `${Math.round((coveredTotal / (daysLogged * 1440)) * 100)}%` : "—", "有记录日的区间并集 / 24h");
  kpi(secondary, "支出", spend.length ? `¥${spend.reduce((s2, r) => s2 + (r.amount || 0), 0).toFixed(0)}` : "¥0", spend.length ? `${spend.length} 笔` : "本期没有支出");

  if (invalidDates.length) {
    // 异常提示压成一行：说明 + 直接可点的校对按钮；柱顶另有 ⚠ 徽标
    const warning = host.createDiv({ cls: "lubi-data-warning is-compact", attr: { role: "status" } });
    icon(warning, "triangle-alert", "lubi-icon lubi-warning-icon");
    warning.createSpan({ cls: "lubi-warning-text", text: `${invalidDates.length} 天有跨出当日的记录，统计按日边界截断。` });
    let links: HTMLElement;
    if (invalidDates.length > 5) {
      const details = warning.createEl("details");
      details.createEl("summary", { text: `展开 ${invalidDates.length} 个待校对日期` });
      links = details.createDiv({ cls: "lubi-data-warning-links" });
    } else links = warning.createDiv({ cls: "lubi-data-warning-links" });
    for (const date of invalidDates) button(links, `校对 ${date}`, () => plugin.openDate(date), { cls: "lubi-btn-sm" });
  }

  // 堆叠柱：纵轴 24h 封顶（年视图按最大月），无底轨，横向网格 + 日均线 + tooltip
  const catOrder = plugin.settings.categories.map((c) => c.name);
  // 堆叠自下而上 = 图例自左而右；「背景时间」（睡眠）固定在最底层
  const isRest = (c: string) => !!categoryOf(plugin.settings, c).rest;
  const cats = [...new Set(timed.map((r) => r.category))].sort((a, b) => {
    if (isRest(a) !== isRest(b)) return isRest(a) ? -1 : 1;
    const ia = catOrder.indexOf(a);
    const ib = catOrder.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const chart = host.createDiv({ cls: "lubi-card lubi-chart-card" });
  const chartHead = chart.createDiv({ cls: "lubi-panel-head" });
  el(chartHead, "h3", "lubi-panel-title", state.period === "year" ? "每月记录时长" : "每日记录时长");
  segmented<"chart" | "table">(chartHead, [{ id: "chart", label: "图表" }, { id: "table", label: "表格" }], state.display || "chart", (display) => setState({ display })).addClass("lubi-chart-mode");
  const legend = chartHead.createDiv({ cls: "lubi-chart-legend lubi-push-right" });
  if (isEmpty) legend.createSpan({ cls: "lubi-muted lubi-review-empty-note", text: "本期暂无记录" });
  for (const c of cats) {
    const li = legend.createSpan({ cls: "lubi-chart-legend-item" });
    catDot(li, categoryOf(plugin.settings, c), categoryTone(plugin.settings, c));
    li.createSpan({ text: c });
  }
  const bucketTotals = buckets.map((b) => b.dates.flatMap((d) => data.get(d) || []).filter((r) => r.minutes > 0).reduce((s, r) => s + r.minutes, 0));
  const bucketStats = buckets.map((b) => b.dates.reduce((result, date) => {
    const stats = dailyStats.get(date);
    if (stats) {
      result.covered += stats.coveredMinutes;
      result.overlap += stats.overlapMinutes;
      result.invalid += stats.invalidCount;
    }
    return result;
  }, { covered: 0, overlap: 0, invalid: 0 }));
  const isYear = state.period === "year";
  const cap = isYear ? Math.max(60, ...bucketTotals) : 1440;
  const ticks = isYear ? niceTicks(cap) : [360, 720, 1080, 1440];
  const chartBox = chart.createDiv({ cls: `lubi-chart ${state.period === "month" ? "is-dense" : ""}`.trim() });
  chartBox.hidden = state.display === "table";
  const gridEl = chartBox.createDiv({ cls: "lubi-chart-grid" });
  for (const t of ticks) {
    const g = gridEl.createDiv({ cls: "lubi-chart-gridline" });
    g.style.bottom = `${(t / cap) * 100}%`;
    g.createSpan({ cls: "lubi-chart-tick", text: fmtHours(t) });
  }
  const loggedBuckets = bucketTotals.filter((v, i) => v > 0 && !bucketStats[i].invalid).map((v) => Math.min(v, cap));
  if (loggedBuckets.length > 1) {
    const avg = loggedBuckets.reduce((s, v) => s + v, 0) / loggedBuckets.length;
    const a = gridEl.createDiv({ cls: "lubi-chart-avg" });
    a.style.bottom = `${Math.min(100, (avg / cap) * 100)}%`;
    a.createSpan({ cls: "lubi-chart-avg-label", text: `${invalidDates.length ? "有效日均" : "均"} ${fmtHours(avg)}` });
  }
  const bars = chartBox.createDiv({ cls: "lubi-bars" });
  const today = todayStr();
  buckets.forEach((b, i) => {
    const recs = b.dates.flatMap((d) => data.get(d) || []).filter((r) => r.minutes > 0);
    const bt = bucketTotals[i];
    const isFuture = b.dates[0] > today;
    const stats = bucketStats[i];
    // 柱子已有自绘的悬浮明细卡：读屏文字放进隐藏的 span，不用 aria-label，免得 Obsidian 再叠一个提示
    const col = bars.createEl("button", { cls: `lubi-bar-col ${b.dates.includes(today) ? "is-today" : ""} ${isFuture ? "is-future" : ""} ${bt ? "" : "is-empty"}`.trim(), attr: { type: "button" } });
    col.createSpan({ cls: "lubi-sr-only", text: `${b.label}，记录 ${fmtHours(bt)}，覆盖 ${fmtHours(stats.covered)}${stats.invalid ? "，存在待校对记录" : stats.overlap ? `，并行 ${fmtDuration(stats.overlap)}` : ""}。按回车查看` });
    col.dataset.idx = String(i);
    const stack = col.createDiv({ cls: "lubi-bar-stack" });
    const over = bt > cap + 1;
    stack.style.height = `${Math.min(100, (bt / cap) * 100)}%`;
    if (bt) {
      for (const c of cats) {
        const v = sum(recs, c);
        if (!v) continue;
        const seg = stack.createDiv({ cls: `lubi-bar-seg ${isRest(c) ? "is-rest" : ""}`.trim() });
        seg.style.flexBasis = `${(v / bt) * 100}%`;
        seg.style.setProperty("--chip", categoryTone(plugin.settings, c));
        seg.style.background = categoryTone(plugin.settings, c);
      }
      const val = stack.createDiv({ cls: "lubi-bar-val", text: fmtHours(bt) });
      if (stats.invalid) {
        val.addClass("is-over");
        val.setText(`⚠ ${fmtHours(bt)}`);
        stack.addClass("is-over");
      } else if (over) {
        val.addClass("is-parallel");
        val.setText(`∥ ${fmtHours(bt)}`);
      }
    }
    col.createDiv({ cls: "lubi-bar-label", text: b.label });
    col.addEventListener("click", () => {
      if (isYear) setState({ period: "month", anchor: b.dates[0] });
      else plugin.openDate(b.dates[0]);
    });
  });
  hoverTip(bars, ".lubi-bar-col", (t) => {
    const i = Number(t.dataset.idx);
    const b = buckets[i];
    const bt = bucketTotals[i];
    const recs = b.dates.flatMap((d) => data.get(d) || []).filter((r) => r.minutes > 0);
    const head = isYear ? b.label : `周${weekdayZh(b.dates[0])} ${shortDate(b.dates[0])}`;
    if (!bt) return [`${head} · 没有记录`];
    const rows: (string | HTMLElement)[] = [`${head} · ${fmtHours(bt)}`];
    const stats = bucketStats[i];
    if (stats.invalid) rows.push("⚠ 有记录跨出当天，点击后校对");
    else if (bt > cap + 1 && !isYear) rows.push("∥ 有并行记录，柱高已截断");
    rows.push(`实际覆盖 ${fmtHours(stats.covered)}${stats.overlap ? ` · 并行 ${fmtDuration(stats.overlap)}` : ""}`);
    for (const c of cats) {
      const v = sum(recs, c);
      if (!v) continue;
      const line = document.createElement("div");
      line.className = "lubi-tip-row";
      const d = document.createElement("span");
      d.className = "lubi-dot";
      d.style.setProperty("--dot", categoryTone(plugin.settings, c));
      line.append(d, `${c} ${fmtHours(v)}`, ` · ${Math.round((v / bt) * 100)}%`);
      rows.push(line);
    }
    return rows;
  });

  const tableWrap = chart.createDiv({ cls: "lubi-review-table-wrap" });
  tableWrap.hidden = state.display !== "table";
  const table = tableWrap.createEl("table", { cls: "lubi-review-table" });
  table.createEl("caption", { text: `${label} · 按日期与分类的记录时长` });
  const header = table.createEl("thead").createEl("tr");
  for (const title of ["日期", "记录", "覆盖", ...cats, "校对"]) header.createEl("th", { text: title, attr: { scope: "col" } });
  const tbody = table.createEl("tbody");
  buckets.forEach((bucket, i) => {
    const row = tbody.createEl("tr");
    const day = row.createEl("th", { attr: { scope: "row" } });
    const open = day.createEl("button", { cls: "lubi-table-link", text: bucket.label, attr: { type: "button" } });
    open.addEventListener("click", () => state.period === "year" ? setState({ period: "month", anchor: bucket.dates[0] }) : plugin.openDate(bucket.dates[0]));
    row.createEl("td", { text: fmtHours(bucketTotals[i]) });
    row.createEl("td", { text: bucket.dates.some(d => unknownStartDates.has(d)) ? "—" : fmtHours(bucketStats[i].covered) });
    const recs = bucket.dates.flatMap((d) => data.get(d) || []).filter((r) => r.minutes > 0);
    for (const cat of cats) row.createEl("td", { text: sum(recs, cat) ? fmtHours(sum(recs, cat)) : "—" });
    const issues = row.createEl("td");
    const flagged = bucket.dates.filter((date) => dailyStats.get(date)?.invalidCount);
    if (!flagged.length) issues.setText("—");
    else for (const date of flagged) {
      const fix = issues.createEl("button", { cls: "lubi-table-link", text: date, attr: { type: "button", "aria-label": `校对 ${date} 的跨日记录` } });
      fix.addEventListener("click", () => plugin.openDate(date));
    }
  });

  if (isYear) renderHeatmap(plugin, host, from, to, dailyStats, unknownStartDates);

  // 分类明细 + 事项 Top
  const extras = host.createDiv({ cls: "lubi-card lubi-review-extras" });
  const detail = extras.createEl("details", { cls: "lubi-fold lubi-review-breakdown" });
  detail.createEl("summary", { text: "分类、事项与支出" });
  const grid = detail.createDiv({ cls: "lubi-review-grid" });
  const byCat = grid.createDiv({ cls: "lubi-section" });
  el(byCat, "h3", "lubi-panel-title", "按分类");
  if (!cats.length) byCat.createDiv({ cls: "lubi-muted lubi-review-empty-detail", text: "暂无分类记录" });
  for (const c of cats) {
    const v = sum(timed, c);
    const row = byCat.createDiv({ cls: "lubi-row-bar" });
    const head = row.createDiv({ cls: "lubi-row-bar-head" });
    catDot(head, categoryOf(plugin.settings, c), categoryTone(plugin.settings, c));
    head.createSpan({ cls: "lubi-legend-name", text: c });
    head.createSpan({ cls: "lubi-legend-val", text: fmtHours(v) });
    head.createSpan({ cls: "lubi-muted lubi-legend-pct", text: `${Math.round((v / total) * 100)}%` });
    const track = row.createDiv({ cls: "lubi-track" });
    const fill = track.createDiv({ cls: "lubi-fill" });
    fill.style.width = `${(v / total) * 100}%`;
    fill.style.background = categoryTone(plugin.settings, c);
  }

  const top = grid.createDiv({ cls: "lubi-section lubi-review-top" });
  el(top, "h3", "lubi-panel-title", "事项 Top 5");
  const byTitle = new Map<string, { min: number; n: number; cat: string }>();
  for (const r of timed) {
    const k = `${r.category}·${r.title}`;
    const cur = byTitle.get(k) || { min: 0, n: 0, cat: r.category };
    cur.min += r.minutes;
    cur.n++;
    byTitle.set(k, cur);
  }
  const ranked = [...byTitle.entries()].sort((a, b) => b[1].min - a[1].min).slice(0, 5);
  const topMax = ranked.length ? ranked[0][1].min : 1;
  if (!ranked.length) top.createDiv({ cls: "lubi-muted lubi-review-empty-detail", text: "暂无事项记录" });
  for (const [k, v] of ranked) {
    const row = top.createDiv({ cls: "lubi-row-bar" });
    const head = row.createDiv({ cls: "lubi-row-bar-head" });
    const cat = categoryOf(plugin.settings, v.cat);
    catDot(head, cat, categoryTone(plugin.settings, cat.name));
    head.createSpan({ cls: "lubi-legend-name", text: k.split("·").slice(1).join("·") });
    head.createSpan({ cls: "lubi-muted lubi-top-count", text: `${v.n} 次` });
    head.createSpan({ cls: "lubi-legend-val", text: fmtHours(v.min) });
    const track = row.createDiv({ cls: "lubi-track" });
    const fill = track.createDiv({ cls: "lubi-fill" });
    fill.style.width = `${(v.min / topMax) * 100}%`;
    fill.style.background = categoryTone(plugin.settings, cat.name);
  }

  const sp = grid.createDiv({ cls: "lubi-section" });
  el(sp, "h3", "lubi-panel-title", "支出");
  if (spend.length) {
    const byType = new Map<string, number>();
    for (const r of spend) byType.set(r.expenseType || "其他", (byType.get(r.expenseType || "其他") || 0) + (r.amount || 0));
    const totalSpend = [...byType.values()].reduce((s, v) => s + v, 0);
    for (const [t, v] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
      const row = sp.createDiv({ cls: "lubi-row-bar" });
      const head = row.createDiv({ cls: "lubi-row-bar-head" });
      head.createSpan({ cls: "lubi-legend-name", text: t });
      head.createSpan({ cls: "lubi-legend-val", text: `¥${v.toFixed(2)}` });
      head.createSpan({ cls: "lubi-muted lubi-legend-pct", text: totalSpend ? `${Math.round((v / totalSpend) * 100)}%` : "—" });
      const track = row.createDiv({ cls: "lubi-track" });
      const fill = track.createDiv({ cls: "lubi-fill" });
      fill.style.width = `${totalSpend ? Math.max(0, Math.min(100, (v / totalSpend) * 100)) : 0}%`;
    }
    const list = sp.createDiv({ cls: "lubi-spend-list" });
    for (const r of spend.slice().sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)).reverse().slice(0, 30)) {
      const row = list.createDiv({ cls: "lubi-legend-row" });
      row.createSpan({ cls: "lubi-muted", text: `${shortDate(r.date)} ${r.start}` });
      row.createSpan({ cls: "lubi-legend-name", text: r.title });
      row.createSpan({ cls: "lubi-muted", text: r.expenseType || "" });
      row.createSpan({ cls: "lubi-legend-val", text: `¥${(r.amount || 0).toFixed(2)}` });
    }
  } else {
    sp.createDiv({ cls: "lubi-muted lubi-review-empty-detail", text: "暂无支出记录" });
  }
  renderReviewInsights(extras, plugin, from, to, data, timed, total);
}

/** 次要分析统一放在页面底部的折叠区域，不改变任务或日记数据。 */
function renderReviewInsights(host: HTMLElement, plugin: LubiPlugin, from: string, to: string, data: Map<string, Rec[]>, timed: Rec[], total: number): void {
  const dates = eachDate(from, to).filter((d) => d <= todayStr());
  const instances = new Map<string, { task: Task; date: string; actual: number }>();
  for (const date of dates) {
    for (const task of plugin.tasks.forDate(date).filter((t) => !plugin.tasks.children(t.id).length)) instances.set(`${task.id}|${date}`, { task, date, actual: 0 });
    for (const rec of data.get(date) || []) if (rec.task) {
      const hit = instances.get(`${rec.task}|${date}`);
      if (hit && rec.minutes > 0) hit.actual += rec.minutes;
    }
  }
  const planned = [...instances.values()].filter((x) => x.task.estimate > 0);
  const plannedMin = planned.reduce((s, x) => s + x.task.estimate, 0);
  const linkedActual = planned.reduce((s, x) => s + x.actual, 0);
  const donePlans = planned.filter((x) => x.actual > 0 || plugin.tasks.isDoneOn(x.task, x.date)).length;

  const gaps: { date: string; largest: number; total: number; start: number }[] = [];
  for (const date of dates) {
    const rows = (data.get(date) || []).filter((r) => r.minutes > 0).map((r) => ({ start: Math.max(8 * 60, hmToMin(r.start)), end: Math.min(22 * 60, hmToMin(r.start) + r.minutes) })).filter((r) => r.end > r.start).sort((a, b) => a.start - b.start);
    let cursor = 8 * 60, largest = 0, gapTotal = 0, largestStart = cursor;
    for (const row of rows) {
      if (row.start > cursor) { const gap = row.start - cursor; gapTotal += gap; if (gap > largest) { largest = gap; largestStart = cursor; } }
      cursor = Math.max(cursor, row.end);
    }
    if (cursor < 22 * 60) { const gap = 22 * 60 - cursor; gapTotal += gap; if (gap > largest) { largest = gap; largestStart = cursor; } }
    if (largest > 0) gaps.push({ date, largest, total: gapTotal, start: largestStart });
  }
  gaps.sort((a, b) => b.largest - a.largest);

  const wrap = host.createEl("details", { cls: "lubi-fold lubi-review-insights" });
  wrap.createEl("summary", { text: "详细分析" });
  const capsule = wrap.createDiv({ cls: "lubi-section lubi-capsule" });
  el(capsule, "h3", "lubi-panel-title", "本期摘要");
  const byCat = new Map<string, number>(), byTitle = new Map<string, number>();
  for (const r of timed) { byCat.set(r.category, (byCat.get(r.category) || 0) + r.minutes); byTitle.set(r.title, (byTitle.get(r.title) || 0) + r.minutes); }
  const topCat = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0];
  const topTitle = [...byTitle.entries()].sort((a, b) => b[1] - a[1])[0];
  capsule.createDiv({ cls: "lubi-capsule-quote", text: total ? `这段时间你投入了 ${fmtHours(total)}，主要花在「${topCat?.[0] || "未分类"}」。` : "这段时间还没有足够记录生成总结。" });
  capsule.createDiv({ cls: "lubi-muted lubi-capsule-detail", text: `${topTitle ? `最多投入事项：${topTitle[0]}（${fmtHours(topTitle[1])}）` : "先记录几条事项，之后会生成重点。"}${gaps.length ? ` · 最大空白 ${fmtDuration(gaps[0].largest)}` : ""}` });
  const detailGrid = wrap.createDiv({ cls: "lubi-review-detail-grid" });
  const variance = detailGrid.createDiv({ cls: "lubi-section lubi-insight-card" });
  el(variance, "h3", "lubi-panel-title", "计划 vs 实际");
  if (!planned.length) variance.createDiv({ cls: "lubi-muted", text: "暂无带预计用时的计划" });
  else {
    variance.createDiv({ cls: "lubi-insight-lead", text: `${donePlans}/${planned.length} 个计划已有实际记录 · 预计 ${fmtHours(plannedMin)} · 已记录 ${fmtHours(linkedActual)}` });
    for (const x of planned.slice().sort((a, b) => Math.abs(b.actual - b.task.estimate) - Math.abs(a.actual - a.task.estimate)).slice(0, 4)) {
      const delta = x.actual - x.task.estimate;
      const row = variance.createDiv({ cls: "lubi-insight-row" });
      row.createSpan({ cls: "lubi-insight-name", text: x.task.title });
      row.createSpan({ cls: "lubi-muted", text: `${fmtDuration(x.task.estimate)} → ${x.actual ? fmtDuration(x.actual) : "未记录"}` });
      if (x.actual) row.createSpan({ cls: delta > 0 ? "lubi-insight-delta is-warn" : "lubi-insight-delta is-ok", text: `${delta >= 0 ? "+" : "−"}${fmtDuration(Math.abs(delta))}` });
    }
  }
  const holes = detailGrid.createDiv({ cls: "lubi-section lubi-insight-card" });
  el(holes, "h3", "lubi-panel-title", "未记录时段");
  if (!gaps.length) holes.createDiv({ cls: "lubi-muted", text: "08:00–22:00 无未记录时段" });
  else {
    holes.createDiv({ cls: "lubi-insight-lead", text: `最大空白 ${fmtDuration(gaps[0].largest)} · ${shortDate(gaps[0].date)} ${minToHM(gaps[0].start)}` });
    for (const g of gaps.slice(0, 3)) {
      const row = holes.createDiv({ cls: "lubi-insight-row" });
      row.createSpan({ cls: "lubi-insight-name", text: shortDate(g.date) });
      row.createSpan({ cls: "lubi-muted", text: `${minToHM(g.start)} 起最大空白 ${fmtDuration(g.largest)}` });
      row.createEl("button", { cls: "lubi-table-link", text: "查看", attr: { type: "button" } }).addEventListener("click", () => plugin.openDate(g.date));
    }
  }
}

function niceTicks(cap: number): number[] {
  const hours = cap / 60;
  const step = hours <= 40 ? 10 : hours <= 100 ? 25 : hours <= 200 ? 50 : 100;
  const out: number[] = [];
  for (let h = step; h * 60 <= cap; h += step) out.push(h * 60);
  return out;
}

function kpi(parent: HTMLElement, label: string, value: string, sub?: string, cls = ""): HTMLElement {
  const k = parent.createDiv({ cls: `lubi-kpi ${cls}`.trim() });
  k.createDiv({ cls: "lubi-kpi-label", text: label });
  k.createDiv({ cls: "lubi-kpi-value", text: value });
  if (sub) {
    if (label === "有效日均") k.createDiv({ cls: "lubi-muted lubi-kpi-sub", text: sub });
    else { k.setAttribute("tabindex", "0"); tip(k, sub); }
  }
  return k;
}

/** 年视图：GitHub 式覆盖热力图（颜色 = 当天覆盖率），点击某天跳到每日页 */
function renderHeatmap(plugin: LubiPlugin, host: HTMLElement, from: string, to: string, dailyStats: Map<string, { coveredMinutes: number; invalidCount: number }>, unknownStartDates: ReadonlySet<string> = new Set()): void {
  const card = host.createDiv({ cls: "lubi-card lubi-heat-card" });
  const head = card.createDiv({ cls: "lubi-panel-head" });
  el(head, "h3", "lubi-panel-title", "全年覆盖");
  head.createSpan({ cls: "lubi-muted", text: "颜色越深 = 当天记录覆盖越多" });
  const legend = head.createDiv({ cls: "lubi-heat-legend lubi-push-right" });
  legend.createSpan({ cls: "lubi-muted", text: "少" });
  for (let lv = 0; lv <= 4; lv++) legend.createSpan({ cls: `lubi-heat-cell lv-${lv}` });
  legend.createSpan({ cls: "lubi-muted", text: "多" });
  const scroll = card.createDiv({ cls: "lubi-heat-scroll" });
  const grid = scroll.createDiv({ cls: "lubi-heat", attr: { role: "grid", "aria-label": "全年每日覆盖率" } });
  const first = weekStart(from);
  const today = todayStr();
  const allDays = eachDate(first, to);
  const weeks = Math.ceil(allDays.length / 7);
  grid.style.setProperty("--weeks", String(weeks));
  for (let w = 0; w < weeks; w++) {
    const label = grid.createDiv({ cls: "lubi-heat-month" });
    label.style.gridColumn = String(w + 2);
    // 本周内出现某月 1 号（或是区间第一周）就标月份
    const week = allDays.slice(w * 7, w * 7 + 7).filter((d) => d >= from && d <= to);
    const first = week.find((d) => d.endsWith("-01")) || (w === 0 || (week[0] === from) ? week[0] : "");
    if (first) label.setText(`${Number(first.slice(5, 7))}月`);
  }
  ["一", "", "三", "", "五", "", "日"].forEach((t, i) => {
    const l = grid.createDiv({ cls: "lubi-heat-dow", text: t });
    l.style.gridRow = String(i + 2);
  });
  allDays.forEach((d, i) => {
    const cell = grid.createDiv({ cls: "lubi-heat-cell" });
    cell.style.gridColumn = String(Math.floor(i / 7) + 2);
    cell.style.gridRow = String((i % 7) + 2);
    if (d < from || d > to) { cell.addClass("is-out"); return; }
    const st = unknownStartDates.has(d) ? undefined : dailyStats.get(d);
    const ratio = st ? st.coveredMinutes / 1440 : 0;
    const lv = !st ? 0 : ratio < 0.25 ? 1 : ratio < 0.5 ? 2 : ratio < 0.75 ? 3 : 4;
    cell.addClass(`lv-${lv}`);
    if (st?.invalidCount) cell.addClass("is-invalid");
    if (d === today) cell.addClass("is-today");
    if (d > today) cell.addClass("is-future");
    cell.dataset.date = d;
    tip(cell, `${d} 周${weekdayZh(d)} · ${unknownStartDates.has(d) ? "实际开始待核对，覆盖率未知" : st ? `覆盖 ${Math.round(ratio * 100)}%` : "没有记录"}${st?.invalidCount ? " · 待校对" : ""}`);
  });
  grid.addEventListener("click", (e) => {
    const d = (e.target as HTMLElement).closest<HTMLElement>(".lubi-heat-cell")?.dataset.date;
    if (d) plugin.openDate(d);
  });
}

function sum(recs: Rec[], cat: string): number {
  return recs.reduce((s, r) => s + (r.category === cat ? r.minutes : 0), 0);
}

function range(state: ReviewState): { from: string; to: string; label: string; buckets: Bucket[] } {
  const a = state.anchor;
  if (state.period === "week") {
    const from = weekStart(a);
    const to = shiftDate(from, 6);
    return {
      from,
      to,
      label: `${shortDate(from)} – ${shortDate(to)}`,
      buckets: eachDate(from, to).map((d) => ({ key: d, label: `${weekdayZh(d)} ${shortDate(d)}`, dates: [d] })),
    };
  }
  if (state.period === "month") {
    const from = monthStart(a);
    const to = monthEnd(a);
    return {
      from,
      to,
      label: `${a.slice(0, 4)} 年 ${Number(a.slice(5, 7))} 月`,
      buckets: eachDate(from, to).map((d) => ({ key: d, label: String(Number(d.slice(8, 10))), dates: [d] })),
    };
  }
  const y = a.slice(0, 4);
  const buckets: Bucket[] = [];
  for (let m = 1; m <= 12; m++) {
    const ms = `${y}-${String(m).padStart(2, "0")}-01`;
    buckets.push({ key: ms, label: `${m}月`, dates: eachDate(ms, monthEnd(ms)) });
  }
  return { from: `${y}-01-01`, to: `${y}-12-31`, label: `${y} 年`, buckets };
}

function step(state: ReviewState, dir: number): string {
  if (state.period === "week") return shiftDate(state.anchor, 7 * dir);
  const d = parseDate(state.anchor);
  if (state.period === "month") d.setMonth(d.getMonth() + dir, 1);
  else d.setFullYear(d.getFullYear() + dir, 0, 1);
  return dateStr(d);
}

