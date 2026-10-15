import { categoryTone } from "./monochrome";
// 日历·日：24h 时间轴（实线 = 记录，虚线 = 当天有开始时间的计划）+ 右侧当天分布 / 空白时段 / 当天任务下拉清单。
// 计划展示：点计划块 = 记本人用时，是否同时完成由记录窗口明确选择；可取消当天计划。

import { hideTip } from "./tooltips";
import { positionDragReadout } from "./dragReadout";
import { Notice } from "obsidian";
import type LubiPlugin from "../main";
import { formatEstimateComparison, confirmed, isPending, PENDING_KEY, ParsedLine, Rec } from "../core/records";
import { fmtDuration, fmtHours, hmToMin, minToHM, nowHM, shortDate, todayStr } from "../core/time";
import { dayTimeStats, invalidTimedSpan } from "../core/metrics";
import { categoryOf } from "../settings";
import { button, HOUR_PX, infoTip, icon, iconButton, stopAll, tip, undoNotice } from "./components";
import { minuteAt, startDrag } from "./drag";
import { RecordModal, TaskModal, openUnifiedRecord } from "./modals";
import { dayTasks, deleteRecord, OpenRecord, syncLinkedTask } from "./taskList";
import type { Task } from "../core/tasks";
import { planOccurrences } from "../core/planning";
import { updateScheduleWithUndo } from "./tasks";
import { renderDayDistribution } from "./daySummary";

// A dedicated header row keeps the plan-lane title above midnight tasks.
const DAY_START_GUTTER_PX = 32;
const DAY_END_GUTTER_PX = 16;
const snap5 = (m: number) => Math.max(0, Math.min(1440, Math.round(m / 5) * 5));

interface Lane {
  row: ParsedLine;
  lane: number;
  lanes: number;
}

export async function renderCalendarDay(plugin: LubiPlugin, host: HTMLElement, date: string, rerender: () => void, renderPlans: (side: HTMLElement, records: Rec[]) => void, sourceRows?: ParsedLine[]): Promise<void> {
  host.empty();
  host.addClass("lubi-today");
  const rows = sourceRows || await plugin.journal.read(date);
  const timed = rows.filter((r) => r.rec.minutes > 0).sort((a, b) => hmToMin(a.rec.start) - hmToMin(b.rec.start));
  const money = rows.filter((r) => r.rec.minutes <= 0);
  const stats = dayTimeStats(timed.map((row) => row.rec));
  const invalidRows = timed.filter((row) => invalidTimedSpan(row.rec));

  const openNew: OpenRecord = (defaults = {}, onRec) => openUnifiedRecord(plugin, date, defaults, async (rec) => { if (rec && onRec) await onRec(rec); rerender(); });
  const openEdit = (row: ParsedLine) => new RecordModal(plugin.app, plugin, { date, rec: row.rec, line: row.line, onSaved: rerender }).open();

  // ---------- 左：时间轴 ----------
  // 标题行（引导 / 统计 / 跨日警告）单独占第一行，时间轴与右栏同在第二行，保证右栏顶部与时间轴框顶部对齐
  const top = host.createDiv({ cls: "lubi-today-top" });
  if (!plugin.settings.onboardingDone && plugin.journal.dates().length === 0) {
    const hint = top.createDiv({ cls: "lubi-first-record" });
    hint.createSpan({ cls: "lubi-muted", text: "做完打勾；花了时间点「记用时」。完成和记时分开保存。" });
    iconButton(hint, "x", "不再显示入门提示", async () => {
      const previous = plugin.settings.onboardingDone;
      plugin.settings.onboardingDone = true;
      try { await plugin.saveSettings(); hint.remove(); }
      catch (e) { plugin.settings.onboardingDone = previous; new Notice(`保存失败：${(e as Error).message}`, 6000); }
    });
  }

  const summary = top.createDiv({ cls: "lubi-today-summary", attr: { role: "status", "aria-label": "今日摘要" } });
  const summaryItem = (label: string, value: string, hint?: string) => {
    const item = summary.createDiv({ cls: "lubi-summary-item", attr: { tabindex: "0" } });
    item.createSpan({ cls: "lubi-summary-label", text: label });
    item.createSpan({ cls: "lubi-summary-value", text: value });
    if (hint) tip(item, hint);
  };
  summaryItem("记录投入", timed.length ? fmtHours(stats.recordedMinutes) : "—", "所有时间记录之和，并行记录会重复计入。");
  summaryItem("实际覆盖", timed.some(row => row.rec.extra[PENDING_KEY] === "实际开始未核对") ? "—" : timed.length ? fmtHours(stats.coveredMinutes) : "—", "把重叠区间合并后的实际覆盖时间。");
  if (stats.overlapMinutes) summaryItem("并行重叠", fmtDuration(stats.overlapMinutes), "并行记录造成的重复时长。");
  const pendingCount = timed.filter((row) => isPending(row.rec)).length;
  if (pendingCount) summaryItem("待确认", `${pendingCount} 条`, "按计划自动生成、尚未核对为实际时间的记录。");


  if (invalidRows.length) {
    const warning = top.createDiv({ cls: "lubi-data-warning", attr: { role: "status" } });
    warning.createDiv({ text: `${invalidRows.length} 条记录跨出当天。覆盖时间只按当天计算，请核对原记录。` });
    const links = warning.createDiv({ cls: "lubi-data-warning-links" });
    for (const row of invalidRows) button(links, `${row.rec.start} · ${row.rec.title}（${fmtHours(row.rec.minutes)}）`, () => openEdit(row), { cls: "lubi-btn-sm" });
  }
  const left = host.createDiv({ cls: "lubi-today-main" });
  const tlWrap = left.createDiv({ cls: "lubi-timeline-wrap" });
  const scroller = tlWrap.createDiv({ cls: "lubi-timeline-scroll" });
  const readout = tlWrap.createSpan({ cls: "lubi-drag-readout", attr: { role: "status", "aria-live": "polite" } });
  readout.hidden = true;
  const tl = scroller.createDiv({ cls: `lubi-timeline ${money.length ? "has-rail" : ""}`.trim(), attr: { tabindex: "0" } });
  // Keep the tuned hour spacing; the fixed-height scroller (styles.css) scrolls through the full day.
  const hourPx = HOUR_PX;
  const PX_PER_MIN = hourPx / 60;
  tl.dataset.hourPx = String(hourPx);
  tl.style.height = `${24 * hourPx + DAY_START_GUTTER_PX + DAY_END_GUTTER_PX}px`;
  tl.style.setProperty("--lubi-day-start-gutter", `${DAY_START_GUTTER_PX}px`);
  const gutter = tl.createDiv({ cls: "lubi-tl-gutter" });
  const hourLabels: HTMLElement[] = [];
  for (let h = 0; h <= 24; h++) {
    const line = tl.createDiv({ cls: `lubi-tl-line ${h === 0 ? "is-first" : h === 24 ? "is-day-end" : ""}`.trim() });
    line.style.top = `${DAY_START_GUTTER_PX + h * hourPx}px`;
    if (h < 24) {
      const half = tl.createDiv({ cls: "lubi-tl-line lubi-tl-line-half" });
      half.style.top = `${DAY_START_GUTTER_PX + (h + 0.5) * hourPx}px`;
    }
    const edgeClass = h === 0 ? " is-day-start" : h === 24 ? " is-day-end" : "";
    const lab = gutter.createSpan({ cls: `lubi-hour-label${edgeClass}`, text: `${String(h).padStart(2, "0")}:00` });
    lab.style.top = `${DAY_START_GUTTER_PX + h * hourPx}px`;
    hourLabels[h] = lab;
  }
  const canvas = tl.createDiv({ cls: "lubi-tl-canvas" });
  canvas.style.top = `${DAY_START_GUTTER_PX}px`;
  canvas.style.bottom = `${DAY_END_GUTTER_PX}px`;
  // 悬停指示线
  const hover = canvas.createDiv({ cls: "lubi-tl-hover" });
  const hoverLabel = hover.createSpan({ cls: "lubi-tl-hover-label" });
  let dragging = false;
  let readoutTarget: HTMLElement | null = null;
  let readoutAtEnd = false;
  const positionReadout = () => {
    if (!readout.hidden && readoutTarget) positionDragReadout(readout, readoutTarget, scroller, tl, tlWrap, readoutAtEnd);
  };
  scroller.addEventListener("scroll", positionReadout, { passive: true });
  type Area = "record" | "plan";
  const areaAt = (clientX: number): Area => {
    const lane = canvas.querySelector<HTMLElement>(".lubi-plan-lane");
    const rect = lane?.getBoundingClientRect();
    return rect && rect.width > 0 && clientX >= rect.left ? "plan" : "record";
  };
  const showHover = (area: Area, minute: number, label = minToHM(minute), target?: HTMLElement, atEnd = false) => {
    hover.dataset.area = area;
    hover.toggleClass("is-drag-guide", dragging);
    hover.style.top = `${minute * PX_PER_MIN}px`;
    hoverLabel.setText(area === "plan" ? `计划 ${label}` : label);
    hoverLabel.hidden = dragging;
    readout.hidden = !dragging;
    if (dragging) {
      readout.dataset.area = area; readout.dataset.anchor = "axis";
      readoutTarget = target || canvas.querySelector<HTMLElement>(".lubi-block-ghost.is-on"); readoutAtEnd = atEnd;
      // Keep the complete time range on one line.
      readout.setText(label.replace(/\s*–\s*/g, "–"));
      readout.setAttribute("aria-label", `${area === "plan" ? "计划" : "记录"} ${label}`);
      positionReadout();
    }
    hover.addClass("is-on");
  };
  const hideHover = () => {
    hover.removeClass("is-on", "is-drag-guide"); hoverLabel.hidden = true; readout.hidden = true; readoutTarget = null;
    readout.style.visibility = "";
    tl.querySelectorAll(".lubi-drag-obscured").forEach(el => el.classList.remove("lubi-drag-obscured"));
    tl.querySelectorAll(".lubi-drag-guide-segment").forEach(el => el.remove());
    tl.querySelectorAll(".lubi-drag-guide-host").forEach(el => el.classList.remove("lubi-drag-guide-host"));
  };
  canvas.addEventListener("pointermove", (e) => {
    if (dragging) return;
    if ((e.target as HTMLElement).closest(".lubi-block, .lubi-plan")) {
      hideHover();
      return;
    }
    const m = snap5(minuteAt(e.clientY, canvas, PX_PER_MIN));
    showHover(areaAt(e.clientX), m);
  });
  canvas.addEventListener("pointerleave", () => { if (!dragging) hideHover(); });

  if (date === todayStr()) {
    const nowMin = hmToMin(nowHM());
    const now = tl.createDiv({ cls: "lubi-now" });
    now.style.top = `${DAY_START_GUTTER_PX + nowMin * PX_PER_MIN}px`;
    const nl = gutter.createSpan({ cls: "lubi-now-label", text: nowHM() });
    nl.style.top = `${DAY_START_GUTTER_PX + nowMin * PX_PER_MIN}px`;
    const nearHour = Math.round(nowMin / 60);
    if (nearHour > 0 && nearHour < 24 && Math.abs(nowMin - nearHour * 60) <= 12 && hourLabels[nearHour]) hourLabels[nearHour].addClass("is-hidden");
    // Keep the live-time badge between the endpoint label and its neighboring hour label.
    if (nowMin < 30) {
      nl.addClass("is-near-day-start");
      nl.style.top = `${Math.max(DAY_START_GUTTER_PX + 24, DAY_START_GUTTER_PX + nowMin * PX_PER_MIN)}px`;
    } else if (nowMin > 1440 - 30) {
      nl.addClass("is-near-day-end");
      nl.style.top = `${Math.min(DAY_START_GUTTER_PX + 24 * hourPx - 24, DAY_START_GUTTER_PX + nowMin * PX_PER_MIN)}px`;
    }
  }

  // 所有记录边缘（Alt 吸附用）
  const edges = [...new Set(timed.flatMap((r) => [hmToMin(r.rec.start), hmToMin(r.rec.start) + r.rec.minutes]))];

  // 提交拖动结果（带撤销）
  const commit = async (row: ParsedLine, start: number, minutes: number) => {
    const old = row.rec;
    if (hmToMin(old.start) === start && old.minutes === minutes) return;
    // 拖到实际时间即视为已核对：去掉「待确认」
    const next: Rec = confirmed({ ...old, start: minToHM(start), minutes, extra: { ...old.extra } });
    try {
      await plugin.journal.update(date, row.line, next);
      await syncLinkedTask(plugin, old, next);
    } catch (e) {
      new Notice((e as Error).message, 6000);
      rerender();
      return;
    }
    undoNotice(`${next.title} → ${next.start}–${minToHM(start + minutes)}`, async () => {
      const line = await plugin.journal.findLine(date, next);
      if (line === null) return;
      await plugin.journal.update(date, line, old);
      await syncLinkedTask(plugin, next, old);
      rerender();
    });
    rerender();
  };

  let selected: { row: ParsedLine; el: HTMLElement } | null = null;
  const select = (row: ParsedLine, blockEl: HTMLElement) => {
    canvas.querySelectorAll(".lubi-block.is-selected").forEach((b) => b.removeClass("is-selected"));
    blockEl.addClass("is-selected");
    selected = { row, el: blockEl };
  };

  // ---------- 计划层：当天有开始时间、还没完成的任务，画在记录右侧的虚线列 ----------
  const planned = dayTasks(plugin, date);
  // A partial personal record does not mean its planned task is complete.
  const openPlans = planned.filter((t) => !plugin.tasks.isDoneOn(t, date));
  const timedIds = new Set(planOccurrences(plugin.tasks.all, [date]).filter(item => item.timed).map(item => item.task.id));
  const timedPlans = openPlans.filter((t) => timedIds.has(t.id) || (t.origin === "record" && !!t.start));
  canvas.toggleClass("has-plans", timedPlans.length > 0);
  const editPlan = (t: Task) => new TaskModal(plugin.app, plugin, { task: plugin.tasks.byId(t.id) || t, recordDate: date, onSaved: rerender }).open();
  if (timedPlans.length) {
    const lane = canvas.createDiv({ cls: "lubi-plan-lane", attr: { "aria-label": "当天计划" } });
    lane.style.top = `${-DAY_START_GUTTER_PX}px`;
    lane.createDiv({ cls: "lubi-plan-lane-title", text: "计划" });
    const planGap = (start: number, end: number) => {
      if (end <= start) return;
      const gap = canvas.createDiv({ cls: "lubi-plan-gap" });
      gap.style.top = `${start * PX_PER_MIN + 1}px`;
      gap.style.height = `${Math.max(0, (end - start) * PX_PER_MIN - 2)}px`;
    };
    let planEnd = 0;
    for (const task of timedPlans.slice().sort((a, b) => hmToMin(a.start) - hmToMin(b.start))) {
      const start = Math.max(0, Math.min(1440, hmToMin(task.start)));
      planGap(planEnd, start);
      planEnd = Math.max(planEnd, Math.min(1440, start + Math.max(5, task.estimate || 30)));
    }
    planGap(planEnd, 1440);
    for (const t of timedPlans) {
      const cat = categoryOf(plugin.settings, t.category);
      const s0 = hmToMin(t.start);
      const mins = Math.max(5, t.estimate || 30);
      const h = Math.max(Math.min(mins, 1440 - s0) * PX_PER_MIN, 20);
      const pb = lane.createDiv({ cls: "lubi-plan", attr: { role: "button", tabindex: "0" } });
      pb.style.top = `${DAY_START_GUTTER_PX + s0 * PX_PER_MIN}px`;
      pb.style.height = `${h - 2}px`;
      pb.style.setProperty("--chip", categoryTone(plugin.settings, cat.name));
      pb.toggleClass("is-compact", h < 34);
      const ph = pb.createDiv({ cls: "lubi-plan-head" });
      ph.createSpan({ cls: "lubi-plan-title", text: t.title });
      const planActions = pb.createDiv({ cls: "lubi-block-actions" });
      planActions.addEventListener("pointerdown", (e) => e.stopPropagation());
      iconButton(planActions, "pencil", "编辑计划", () => editPlan(t), "lubi-quiet-action");
      const cancelPlan = async () => {
        try {
          const result = await plugin.tasks.cancelPlanOn(t.id, date);
          if (result === "cleared") new Notice(`已取消「${t.title}」当天计划，任务仍保留在未安排列表。`, 5000);
          else if (result === "skipped") new Notice(`已跳过「${t.title}」本次，重复规则未改变。`, 5000);
          rerender();
        } catch (err) {
          new Notice(`取消计划失败：${(err as Error).message}`, 6000);
        }
      };
      iconButton(planActions, "trash-2", `取消「${t.title}」当天计划${t.repeat.kind === "none" ? "（清除排期）" : "（只跳过当天，不改变重复规则）"}`, () => void cancelPlan());
      const planTime = pb.createDiv({ cls: "lubi-plan-time", text: `${t.start}–${minToHM(s0 + mins)}` });
      const handleTop = pb.createDiv({ cls: "lubi-block-handle is-top" });
      const handleBottom = pb.createDiv({ cls: "lubi-block-handle is-bottom" });
      tip(handleTop, "拖动调整计划开始时间（保持结束时间）");
      tip(handleBottom, "拖动调整计划结束时间");
      const late = date === todayStr() && s0 + mins < hmToMin(nowHM());
      pb.toggleClass("is-late", late);
      infoTip(pb, t.title, [...(plugin.tasks.projectOf(t) ? [`项目：${plugin.tasks.projectOf(t)!.title}`] : []), `${shortDate(date)} · ${t.start}–${minToHM(s0 + mins)}`, `预计用时：${t.estimate ? fmtDuration(t.estimate) : "未设置"}`, late ? "已过计划时间 · 待完成" : "待完成", ...(t.repeat.kind !== "none" ? ["重复任务：调整时间会应用于后续重复项"] : [])], t.notes);
      let suppressPointerClick = false;
      const placePlan = (start: number, minutes: number) => {
        const height = Math.max(Math.min(minutes, 1440 - start) * PX_PER_MIN, 20);
        pb.style.top = `${DAY_START_GUTTER_PX + start * PX_PER_MIN}px`;
        pb.style.height = `${height - 2}px`;
        pb.toggleClass("is-compact", height < 34);
        planTime.setText(`${minToHM(start)}–${minToHM(start + minutes)}`);
      };
      const bindPlanDrag = (target: HTMLElement, mode: "move" | "resize-start" | "resize-end") => {
        target.addEventListener("pointerdown", (e) => {
          e.stopPropagation();
          if ((e.target as HTMLElement).closest(".lubi-block-actions, .lubi-pending-badge")) return;
          if (mode === "move" && (e.target as HTMLElement).closest(".lubi-block-handle")) return;
          if (mode !== "move") e.preventDefault();
          suppressPointerClick = false;
          pb.focus({ preventScroll: true });
          startDrag(e, {
            mode, start: s0, minutes: mins, pxPerMin: PX_PER_MIN, min: 0, max: 1440, minMinutes: 5, snap: 5,
            onStart: () => {
              dragging = true;
              pb.setAttribute("data-lubi-tip-suspended", "1"); hideTip();
              suppressPointerClick = true;
              pb.addClass("is-dragging", mode === "move" ? "is-moving" : "is-resizing");
            },
            onMove: (state) => {
              placePlan(state.start, state.minutes);
              showHover("plan", mode === "resize-end" ? state.start + state.minutes : state.start, `${minToHM(state.start)}–${minToHM(state.start + state.minutes)}`, pb, mode === "resize-end");
            },
            onEnd: (state) => {
              dragging = false;
              hideHover();
              pb.removeClass("is-dragging", "is-moving", "is-resizing");
              if (!state) { pb.removeAttribute("data-lubi-tip-suspended"); placePlan(s0, mins); return; }
              if (!state.moved) return;
              pb.setAttribute("data-lubi-tip-suspended", state.start === s0 && state.minutes === mins ? "settled" : "pending");
              placePlan(state.start, state.minutes);
              const patch = mode === "move" ? { start: minToHM(state.start) } : mode === "resize-start" ? { start: minToHM(state.start), estimate: state.minutes } : { estimate: state.minutes };
              void updateScheduleWithUndo(plugin, t.id, patch, `${t.title} 计划 → ${minToHM(state.start)}–${minToHM(state.start + state.minutes)}`, rerender);
            },
          });
        });
      };
      bindPlanDrag(pb, "move");
      bindPlanDrag(handleTop, "resize-start");
      bindPlanDrag(handleBottom, "resize-end");
      handleTop.addEventListener("click", stopAll);
      handleBottom.addEventListener("click", stopAll);
      pb.addEventListener("keydown", (e) => {
        if (e.target !== pb || !["Enter", " "].includes(e.key)) return;
        stopAll(e); suppressPointerClick = false; editPlan(t);
      });
      pb.addEventListener("click", (e) => {
        stopAll(e);
        if ((e.target as HTMLElement).closest(".lubi-block-handle, .lubi-block-actions")) return;
        if (suppressPointerClick && e.detail > 0) { suppressPointerClick = false; return; }
        editPlan(t);
      });
    }
  }

  const lanes = layoutLanes(timed);
  for (const { row, lane, lanes: n } of lanes) {
    const r = row.rec;
    const cat = categoryOf(plugin.settings, r.category);
    const block = canvas.createDiv({ cls: "lubi-block" });
    const startMin = hmToMin(r.start);
    const top = startMin * PX_PER_MIN;
    const invalid = invalidTimedSpan(r);
    const height = Math.max(Math.min(r.minutes, 1440 - startMin) * PX_PER_MIN, 18);
    block.style.top = `${top}px`;
    block.style.height = `${height - 2}px`;
    block.style.left = `calc(var(--lubi-rec-w) * ${lane / n} + ${lane ? 2 : 0}px)`;
    block.style.width = `calc(var(--lubi-rec-w) * ${1 / n} - ${lane ? 2 : 0}px)`;
    block.style.setProperty("--chip", categoryTone(plugin.settings, cat.name));
    block.toggleClass("is-invalid", invalid);
    block.toggleClass("is-rest", !!cat.rest);
    block.toggleClass("is-parallel", n > 1);
    const pending = isPending(r);
    block.toggleClass("is-pending", pending);
    block.setAttribute("tabindex", "0");
    block.setAttribute("role", "button");
    block.addEventListener("focus", () => select(row, block));
    if (height < 30) block.addClass("lubi-block-compact");
    if (height >= 40) block.addClass("has-meta");
    if (height >= 56) block.addClass("lubi-block-tall");
    block.createDiv({ cls: "lubi-block-handle is-top" });
    block.createDiv({ cls: "lubi-block-handle is-bottom" });
    // 常驻标题、时长与时间段；备注、关联和对比细节放在悬停卡中。
    const head = block.createDiv({ cls: "lubi-block-head" });
    icon(head, cat.icon, "lubi-icon lubi-block-icon");
    head.createSpan({ cls: "lubi-block-title", text: r.title });
    if (pending) {
      const confirm = tip(head.createEl("button", { cls: "lubi-pending-badge", text: "待确认", attr: { type: "button" } }), "确认：时间与计划一致");
      confirm.addEventListener("pointerdown", (e) => e.stopPropagation());
      confirm.addEventListener("click", async (e) => {
        stopAll(e);
        try { await plugin.journal.update(date, row.line, confirmed(r)); }
        catch (err) { new Notice((err as Error).message, 6000); }
        rerender();
      });
    }
    const durEl = head.createSpan({ cls: "lubi-block-dur", text: fmtDuration(r.minutes) });
    const meta = block.createDiv({ cls: "lubi-block-meta" });
    const timeEl = meta.createSpan({ cls: "lubi-block-time", text: invalid ? `${r.start} · 需校对` : `${r.start}–${minToHM(startMin + r.minutes)}` });
    const comparison = formatEstimateComparison(r);
    infoTip(block, r.title, [`${shortDate(date)} · ${invalid ? `${r.start}（时长跨出当天，需校对）` : `${r.start}–${minToHM(startMin + r.minutes)}`}`, `分类：${r.category}`, `${pending ? "按计划生成的时长（待确认）" : "实际用时"}：${fmtDuration(r.minutes)}`, ...(comparison ? [comparison] : []), ...(r.task && plugin.tasks.byId(r.task) ? [`关联任务：${plugin.tasks.byId(r.task)!.title}`] : []), ...(pending ? ["按计划自动记下，尚未核对实际时间"] : [])], r.notes);
    const acts = block.createDiv({ cls: "lubi-block-actions" });
    iconButton(acts, "pencil", "编辑", () => openEdit(row), "lubi-quiet-action");
    iconButton(acts, "trash-2", "删除", () => void deleteRecord(plugin, date, row, rerender), "lubi-quiet-action");

    const live = (s: { start: number; minutes: number }, atEnd = false) => {
      block.style.top = `${s.start * PX_PER_MIN}px`;
      block.style.height = `${Math.max(s.minutes * PX_PER_MIN, 18) - 2}px`;
      timeEl.setText(`${minToHM(s.start)}–${minToHM(s.start + s.minutes)}`);
      durEl.setText(fmtDuration(s.minutes));
      if (dragging) showHover("record", atEnd ? s.start + s.minutes : s.start, `${minToHM(s.start)} – ${minToHM(s.start + s.minutes)}`, block, atEnd);
    };
    const bind = (target: HTMLElement, mode: "move" | "resize-start" | "resize-end") => {
      target.addEventListener("pointerdown", (e) => {
        if ((e.target as HTMLElement).closest(".lubi-block-actions, .lubi-pending-badge")) return;
        if (mode !== "move") e.stopPropagation();
        select(row, block);
        block.focus({ preventScroll: true });
        startDrag(e, {
          mode,
          start: startMin,
          minutes: r.minutes,
          pxPerMin: PX_PER_MIN,
          edges: edges.filter((x) => x !== startMin && x !== startMin + r.minutes),
          onStart: () => {
            dragging = true;
            block.setAttribute("data-lubi-tip-suspended", "1"); hideTip();
            block.addClass("is-dragging");
            block.addClass(mode === "move" ? "is-moving" : "is-resizing");
          },
          onMove: s => live(s, mode === "resize-end"),
          onEnd: (s) => {
            dragging = false;
            hideHover();
            block.removeClass("is-dragging", "is-moving", "is-resizing");
            if (s === null) {
              block.removeAttribute("data-lubi-tip-suspended");
              live({ start: startMin, minutes: r.minutes });
              return;
            }
            if (!s.moved) {
              if (mode === "move") openEdit(row);
              return;
            }
            block.setAttribute("data-lubi-tip-suspended", s.start === startMin && s.minutes === r.minutes ? "settled" : "pending");
            live(s, mode === "resize-end");
            void commit(row, s.start, s.minutes);
          },
        });
      });
    };
    if (invalid) {
      block.addEventListener("click", (e) => {
        if (!(e.target as HTMLElement).closest(".lubi-block-actions, .lubi-pending-badge")) openEdit(row);
      });
    } else {
      bind(block, "move");
      bind(block.querySelector(".lubi-block-handle.is-top") as HTMLElement, "resize-start");
      bind(block.querySelector(".lubi-block-handle.is-bottom") as HTMLElement, "resize-end");
    }
  }

  // 时间黑洞：≥30 分钟的空白段，悬停显示「记这段」（借鉴 Timing / Toggl 的事后补记）
  const gaps = blackHoles(timed.map((row) => row.rec), date);
  for (const g of gaps) {
    const gap = canvas.createDiv({ cls: "lubi-gap" });
    gap.style.top = `${g.start * PX_PER_MIN + 1}px`;
    gap.style.height = `${g.minutes * PX_PER_MIN - 2}px`;
    const fill = gap.createEl("button", { cls: "lubi-gap-btn", attr: { type: "button", "aria-label": `补记空白 ${minToHM(g.start)}–${minToHM(g.start + g.minutes)}，${fmtDuration(g.minutes)}` } });
    icon(fill, "plus", "lubi-icon");
    fill.createSpan({ text: `记这段 · ${minToHM(g.start)}–${minToHM(g.start + g.minutes)} · ${fmtDuration(g.minutes)}` });
    fill.addEventListener("pointerdown", (e) => e.stopPropagation());
    fill.addEventListener("click", (e) => {
      stopAll(e);
      openNew({ start: minToHM(g.start), minutes: g.minutes });
    });
  }

  // 空白处按起始位置区分记录 / 计划；跨区移动不切换创建类型。
  const ghost = canvas.createDiv({ cls: "lubi-block lubi-block-ghost" });
  const ghostLabel = ghost.createDiv({ cls: "lubi-block-head" });
  const openArea = (area: Area, start: number, minutes: number) => {
    if (area === "plan") new TaskModal(plugin.app, plugin, { defaults: { date, start: minToHM(start), estimate: minutes }, onSaved: rerender }).open();
    else openNew({ start: minToHM(start), minutes });
  };
  canvas.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest(".lubi-block, .lubi-gap-btn, .lubi-plan")) return;
    const area = areaAt(e.clientX);
    const at = snap5(minuteAt(e.clientY, canvas, PX_PER_MIN));
    ghost.dataset.area = area;
    startDrag(e, {
      mode: "create",
      start: at,
      minutes: 0,
      pxPerMin: PX_PER_MIN,
      minMinutes: 15,
      edges,
      onStart: () => {
        dragging = true;
        ghost.addClass("is-on");
      },
      onMove: (s) => {
        ghost.style.top = `${s.start * PX_PER_MIN}px`;
        ghost.style.height = `${s.minutes * PX_PER_MIN - 2}px`;
        ghostLabel.setText(`${area === "plan" ? "计划" : "记录"} ${minToHM(s.start)} – ${minToHM(s.start + s.minutes)} · ${fmtDuration(s.minutes)}`);
        showHover(area, s.start, `${minToHM(s.start)}–${minToHM(s.start + s.minutes)}`);
      },
      onEnd: (s) => {
        dragging = false;
        ghost.removeClass("is-on");
        hideHover();
        if (!s || !s.moved) return;
        openArea(area, s.start, s.minutes);
      },
    });
  });
  canvas.addEventListener("dblclick", (e) => {
    if ((e.target as HTMLElement).closest(".lubi-block, .lubi-gap-btn, .lubi-plan")) return;
    const m = Math.round(minuteAt(e.clientY, canvas, PX_PER_MIN) / 15) * 15;
    openArea(areaAt(e.clientX), m, 30);
  });

  // 键盘：选中块后 ↑↓ 移动 5 分钟，Shift+↑↓ 改时长，Enter 编辑，Delete 删除
  tl.addEventListener("keydown", (e) => {
    if (!selected || (e.target !== tl && !(e.target as HTMLElement).classList.contains("lubi-block"))) return;
    const r = selected.row.rec;
    if (invalidTimedSpan(r) && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      new Notice("请先在编辑表单校对这条跨日记录的时长");
      return;
    }
    const s = hmToMin(r.start);
    const step = e.altKey ? 1 : 5;
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const d = e.key === "ArrowUp" ? -step : step;
      if (e.shiftKey) void commit(selected.row, s, Math.max(5, Math.min(1440 - s, r.minutes + d)));
      else void commit(selected.row, Math.max(0, Math.min(1440 - r.minutes, s + d)), r.minutes);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openEdit(selected.row);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      void deleteRecord(plugin, date, selected.row, rerender);
    } else if (e.key === "Escape") {
      selected.el.removeClass("is-selected");
      selected = null;
    }
  });

  // 财务记录：只有存在时才显示右侧栏
  if (money.length) {
    const rail = tl.createDiv({ cls: "lubi-tl-rail" });
    for (const row of money) {
      const r = row.rec;
      const cat = categoryOf(plugin.settings, r.category);
      const pin = rail.createEl("button", { cls: "lubi-pin", attr: { type: "button", "aria-label": `${r.start} ${r.category} ${r.title}${r.amount !== undefined ? `，¥${r.amount}` : ""}。点击编辑。` } });
      infoTip(pin, r.title, [`${shortDate(date)} · ${r.start}`, `分类：${r.category}`, ...(r.amount !== undefined ? [`支出：¥${r.amount}`] : [])], r.notes);
      pin.style.top = `${hmToMin(r.start) * PX_PER_MIN}px`;
      pin.style.setProperty("--chip", categoryTone(plugin.settings, cat.name));
      icon(pin, cat.icon, "lubi-icon");
      pin.createSpan({ cls: "lubi-pin-title", text: r.title });
      if (r.amount !== undefined) pin.createSpan({ cls: "lubi-pin-amt", text: `¥${r.amount}` });
      pin.addEventListener("click", (e) => {
        stopAll(e);
        openEdit(row);
      });
    }
  }
  // 首屏位置：今天 = max(首条记录, 现在 − 2h)；其他日期 = 首条记录（没有则 06:00）
  const firstStart = timed.length ? hmToMin(timed[0].rec.start) : null;
  const targetMin = date === todayStr()
    ? Math.max(firstStart ?? 0, hmToMin(nowHM()) - 120)
    : firstStart ?? 6 * 60;
  const targetPx = Math.max(0, Math.round(targetMin * PX_PER_MIN - 16));
  scroller.dataset.scrollTarget = String(targetPx);

  // 视口外还有记录时的浮标：「↑ 更早 2 条」「↓ 更晚 1 条」，点击平滑滚到最近的一条
  const moreUp = tlWrap.createEl("button", { cls: "lubi-tl-more is-up", attr: { type: "button", "aria-label": "查看更早的记录" } });
  const moreDown = tlWrap.createEl("button", { cls: "lubi-tl-more is-down", attr: { type: "button", "aria-label": "查看更晚的记录" } });
  // Keep the accessible label intact when scroll updates change the visible caption.
  const moreUpCaption = moreUp.createSpan(), moreDownCaption = moreDown.createSpan();
  const spans = timed.map((row) => ({ start: hmToMin(row.rec.start), end: Math.min(1440, hmToMin(row.rec.start) + row.rec.minutes) }));
  const scrollToMin = (m: number) => {
    const top = Math.max(0, m * PX_PER_MIN - 24);
    if (typeof scroller.scrollTo === "function") scroller.scrollTo({ top, behavior: "smooth" });
    else scroller.scrollTop = top;
  };
  const updateMore = () => {
    const h = scroller.clientHeight;
    const topMin = scroller.scrollTop / PX_PER_MIN;
    const bottomMin = (scroller.scrollTop + h) / PX_PER_MIN;
    const above = h ? spans.filter((x) => x.end <= topMin + 1) : [];
    const below = h ? spans.filter((x) => x.start >= bottomMin - 1) : [];
    moreUp.toggleClass("is-on", above.length > 0);
    moreDown.toggleClass("is-on", below.length > 0);
    moreUpCaption.setText(above.length ? `↑ 更早 ${above.length} 条 · ${minToHM(above[0].start)}–${minToHM(above[above.length - 1].end)}` : "");
    moreDownCaption.setText(below.length ? `↓ 更晚 ${below.length} 条 · ${minToHM(below[0].start)} 起` : "");
    moreUp.onclick = () => above.length && scrollToMin(above[above.length - 1].start);
    moreDown.onclick = () => below.length && scrollToMin(below[0].start);
  };
  scroller.addEventListener("scroll", updateMore, { passive: true });
  window.requestAnimationFrame(() => {
    if (!scroller.dataset.restored) scroller.scrollTop = targetPx;
    updateMore();
  });

  // ---------- 右：摘要 ----------
  const side = host.createDiv({ cls: "lubi-today-side" });
  renderDayDistribution(plugin, side, rows.map((r) => r.rec), date);
  renderPlans(side, rows.map(row => row.rec));
  renderGapCard(side, gaps, scrollToMin, openNew);
}

/** 空白时段：最长的几段，点一下滚到那里 / 直接补记 */
function renderGapCard(side: HTMLElement, gaps: { start: number; minutes: number }[], scrollTo: (m: number) => void, openNew: OpenRecord): void {
  if (!gaps.length) return;
  const card = side.createEl("details", { cls: "lubi-card lubi-section lubi-gap-card lubi-fold" });
  card.open = true;
  const head = card.createEl("summary", { cls: "lubi-panel-head" });
  head.createSpan({ cls: "lubi-panel-title", text: "空白时段" });
  const total = gaps.reduce((s, g) => s + g.minutes, 0);
  head.createSpan({ cls: "lubi-muted", text: `${gaps.length} 段 · ${fmtHours(total)}` });
  const list = card.createDiv({ cls: "lubi-gap-list" });
  const top = gaps.slice().sort((a, b) => b.minutes - a.minutes).slice(0, 4).sort((a, b) => a.start - b.start);
  for (const g of top) {
    const row = list.createDiv({ cls: "lubi-gap-row" });
    const jump = row.createEl("button", { cls: "lubi-gap-row-main", attr: { type: "button" } });
    jump.createSpan({ cls: "lubi-gap-row-time", text: `${minToHM(g.start)}–${minToHM(g.start + g.minutes)}` });
    jump.createSpan({ cls: "lubi-muted", text: fmtDuration(g.minutes) });
    tip(jump, "在时间轴上定位");
    jump.addEventListener("click", () => scrollTo(g.start));
    iconButton(row, "plus", `补记 ${minToHM(g.start)}–${minToHM(g.start + g.minutes)}`, () => openNew({ start: minToHM(g.start), minutes: g.minutes }), "lubi-gap-row-add");
  }
  if (gaps.length > top.length) card.createDiv({ cls: "lubi-muted lubi-plan-note", text: `另有 ${gaps.length - top.length} 段较短的空白` });
}

/** 当天 ≥ minGap 分钟的空白段。今天只算到此刻，未来日期没有黑洞。 */
export function blackHoles(recs: readonly Rec[], date: string, minGap = 30): { start: number; minutes: number }[] {
  const today = todayStr();
  const limit = date < today ? 1440 : date === today ? hmToMin(nowHM()) : 0;
  if (limit <= 0) return [];
  const spans = recs
    .filter((r) => r.minutes > 0 && !invalidTimedSpan(r))
    .map((r) => [hmToMin(r.start), Math.min(1440, hmToMin(r.start) + r.minutes)] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const out: { start: number; minutes: number }[] = [];
  let cursor = 0;
  for (const [s, e] of spans) {
    if (s > cursor) {
      const end = Math.min(s, limit);
      if (end - cursor >= minGap) out.push({ start: cursor, minutes: end - cursor });
    }
    cursor = Math.max(cursor, e);
    if (cursor >= limit) break;
  }
  if (limit - cursor >= minGap) out.push({ start: cursor, minutes: limit - cursor });
  return out;
}

function layoutLanes(rows: ParsedLine[]): Lane[] {
  // 贪心分道：重叠的记录并排显示
  const out: Lane[] = [];
  let cluster: ParsedLine[] = [];
  let clusterEnd = -1;
  const flush = () => {
    if (!cluster.length) return;
    const laneEnds: number[] = [];
    const placed: { row: ParsedLine; lane: number }[] = [];
    for (const row of cluster) {
      const s = hmToMin(row.rec.start);
      let lane = laneEnds.findIndex((e) => e <= s);
      if (lane < 0) {
        lane = laneEnds.length;
        laneEnds.push(0);
      }
      laneEnds[lane] = s + row.rec.minutes;
      placed.push({ row, lane });
    }
    for (const p of placed) out.push({ ...p, lanes: laneEnds.length });
    cluster = [];
    clusterEnd = -1;
  };
  for (const row of rows) {
    const s = hmToMin(row.rec.start);
    if (cluster.length && s >= clusterEnd) flush();
    cluster.push(row);
    clusterEnd = Math.max(clusterEnd, s + row.rec.minutes);
  }
  flush();
  return out;
}
