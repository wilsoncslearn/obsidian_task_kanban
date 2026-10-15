import { App, Modal, Notice } from "obsidian";
import type LubiPlugin from "../main";
import { arrangeLightTaskForm } from "./lightTask";
import { nameSuggestions } from "./nameSuggestions";
import { confirmed, formatEstimateComparison, isPending, normalizeEstimatedMinutes, PENDING_KEY, Rec } from "../core/records";
import { Task, blankTask, RepeatKind } from "../core/tasks";
import { Executor, executorOf } from "../core/execution";
import { hmToMin, minToHM, nowHM, todayStr, fmtDuration, shortDate, weekdayZh, isValidDate } from "../core/time";
import { categoryOf } from "../settings";
import { parseEstimate, parseQuick, QuickParse } from "../core/quickparse";
import { button, icon, iconButton, segmented, stopAll, tip, undoNotice } from "./components";
import { addRecordAsDone, afterDone, afterUndone, deleteRecord, syncLinkedTask } from "./taskList";
import { saveTaskActual, taskActualRows } from "./taskActual";

let fieldId = 0;
function associate(label: HTMLLabelElement, control: HTMLElement): void {
  const id = `lubi-field-${++fieldId}`;
  label.htmlFor = id;
  control.id = id;
}
function errorHost(control: HTMLElement): HTMLElement | null {
  return (control.closest(".lubi-field") as HTMLElement | null)
    || (control.closest(".lubi-timebar-dur")?.parentElement as HTMLElement | null)
    || control.parentElement;
}
function fieldError(control: HTMLInputElement | HTMLSelectElement | undefined, message: string): void {
  if (!control) { new Notice(message); return; }
  const host = errorHost(control);
  host?.querySelector(".lubi-field-error")?.remove();
  const id = `lubi-error-${++fieldId}`;
  host?.createDiv({ cls: "lubi-field-error", text: message, attr: { id, role: "alert" } });
  control.setAttribute("aria-invalid", "true");
  control.setAttribute("aria-describedby", id);
  const disclosure = control.closest("details");
  if (disclosure) disclosure.open = true;
  control.focus();
}
function clearFieldError(control: HTMLElement): void {
  const host = errorHost(control);
  host?.querySelector(".lubi-field-error")?.remove();
  control.removeAttribute("aria-invalid");
  control.removeAttribute("aria-describedby");
}
function formError(host: HTMLElement, message: string): void {
  let error = host.querySelector<HTMLElement>(".lubi-modal-error");
  if (!error) {
    error = host.createDiv({ cls: "lubi-modal-error", attr: { role: "alert", tabindex: "-1" } });
    host.querySelector(".lubi-modal-actions")?.before(error);
  }
  error.setText(message);
  error.focus();
}

// ---------------- 通用确认 ----------------

export class ConfirmModal extends Modal {
  constructor(app: App, private title: string, private body: string, private onOk: () => void, private okLabel = "确定", private danger = true) {
    super(app);
  }
  onOpen(): void {
    this.modalEl.addClass("lubi-modal", "lubi-modal-sm");
    this.titleEl.setText(this.title);
    this.contentEl.createEl("p", { text: this.body, cls: "lubi-confirm-body" });
    const row = this.contentEl.createDiv({ cls: "lubi-modal-actions" });
    button(row, "取消", () => this.close(), { cls: "lubi-btn-ghost" });
    const ok = button(row, this.okLabel, () => {
      this.close();
      this.onOk();
    }, { primary: !this.danger });
    if (this.danger) ok.addClass("lubi-btn-danger");
  }
}

// ---------------- 删除任务（含关联记录的处理） ----------------

export class DeleteTaskModal extends Modal {
  private removeRecords = false;

  constructor(app: App, private plugin: LubiPlugin, private task: Task, private onDone: () => void) {
    super(app);
  }

  async onOpen(): Promise<void> {
    this.modalEl.addClass("lubi-modal", "lubi-modal-sm");
    this.titleEl.setText("删除任务？");
    const all = [this.task, ...this.plugin.tasks.descendants(this.task.id)];
    const ids = new Set(all.map((t) => t.id));
    const kids = all.length - 1;
    this.contentEl.createEl("p", { cls: "lubi-confirm-body", text: kids ? `「${this.task.title}」会连同 ${kids} 个子任务一起删除。` : `「${this.task.title}」` });
    const linked = await this.plugin.journal.linkedTo(ids);
    if (linked.length) {
      const box = this.contentEl.createDiv({ cls: "lubi-delete-opts", attr: { role: "radiogroup", "aria-label": "关联记录的处理方式" } });
      box.createDiv({ cls: "lubi-muted", text: `时间线上有 ${linked.length} 条记录关联了${kids ? "这些任务" : "这个任务"}：` });
      const opt = (value: boolean, label: string, desc: string) => {
        const row = box.createEl("label", { cls: "lubi-delete-opt" });
        const input = row.createEl("input", { type: "radio", attr: { name: "lubi-delete-records" } });
        input.checked = value === this.removeRecords;
        input.addEventListener("change", () => { if (input.checked) this.removeRecords = value; });
        const text = row.createDiv();
        text.createDiv({ text: label });
        text.createDiv({ cls: "lubi-muted", text: desc });
      };
      opt(false, "保留记录，只解除关联", "时间确实花掉了，回顾统计不变");
      opt(true, `连同这 ${linked.length} 条记录一起删除`, "适合建错的任务或误记的时间");
    }
    const row = this.contentEl.createDiv({ cls: "lubi-modal-actions" });
    button(row, "取消", () => this.close(), { cls: "lubi-btn-ghost" });
    const ok = button(row, "删除", () => void this.run(all, ids, linked.length > 0));
    ok.addClass("lubi-btn-danger");
  }

  private async run(all: Task[], ids: Set<string>, hasLinked: boolean): Promise<void> {
    this.close();
    const snapshot: Task[] = JSON.parse(JSON.stringify(all));
    const removed = this.removeRecords;
    const touched = hasLinked ? await this.plugin.journal.detachTasks(ids, removed) : [];
    await this.plugin.tasks.remove(this.task.id);
    this.onDone();
    const what = !touched.length ? "" : removed ? `，并删除 ${touched.length} 条记录` : `，${touched.length} 条记录已解除关联`;
    undoNotice(`已删除「${this.task.title}」${what}`, async () => {
      for (const t of snapshot) if (!this.plugin.tasks.byId(t.id)) await this.plugin.tasks.upsert(t);
      if (touched.length) await this.plugin.journal.restoreDetached(touched, removed);
      this.onDone();
    });
  }
}

// ---------------- 快捷键速查 ----------------

export const SHORTCUTS: [string, string][] = [
  ["N", "新建任务 / 支出；实际用时在任务内填写"],
  ["1 / 2", "切换 计划 · 回顾"],
  ["T", "回到今天（计划页）"],
  ["← / →", "前一天 / 后一天（计划页）"],
  ["?", "打开本速查卡"],
  ["↑ / ↓", "时间轴：选中块移动 5 分钟（Alt 为 1 分钟）"],
  ["Shift + ↑ / ↓", "时间轴：改时长"],
  ["Enter / Delete", "时间轴：编辑 / 删除选中块"],
  ["Alt + 1…9", "新建记录：切换分类"],
  ["Enter", "新建 / 编辑：保存"],
  ["Esc", "取消拖动 / 关闭窗口"],
];

export class ShortcutsModal extends Modal {
  onOpen(): void {
    this.modalEl.addClass("lubi-modal", "lubi-modal-sm", "lubi-shortcuts-modal");
    this.titleEl.setText("快捷键");
    const list = this.contentEl.createDiv({ cls: "lubi-shortcuts" });
    for (const [k, d] of SHORTCUTS) {
      const row = list.createDiv({ cls: "lubi-shortcut-row" });
      const keys = row.createSpan({ cls: "lubi-shortcut-keys" });
      k.split(" ").forEach((part) => {
        if (part === "/" || part === "+" || part === "…") keys.createSpan({ cls: "lubi-muted", text: ` ${part} ` });
        else keys.createEl("kbd", { text: part });
      });
      row.createSpan({ cls: "lubi-shortcut-desc", text: d });
    }
  }
}

// ---------------- 新建：记录 / 任务 共用一个入口 ----------------

/** done 仅用于内部记录编辑；新建入口只显示任务与支出。 */
export type NewKind = "done" | "money" | "todo";

/**
 * 新建窗口顶部只切换统一任务表单与支出表单。
 */
function kindSwitch(host: HTMLElement, current: NewKind, onPick: (kind: NewKind) => void): void {
  const items: { id: NewKind; label: string; icon: string }[] = [
    { id: "todo", label: "规划任务", icon: "list-todo" },
    { id: "money", label: "记录支出", icon: "wallet" },
  ];
  const seg = segmented<NewKind>(host, items, current, (kind) => { if (kind !== current) onPick(kind); });
  seg.addClass("lubi-mode-seg", "lubi-kind-seg");
  seg.setAttribute("aria-label", "新建类型");
  seg.querySelectorAll<HTMLElement>(".lubi-seg-item").forEach((b, i) => tip(b, ["规划任务：填写预计，完成时填写实际用时", "记录支出：记一笔花费"][i]));
}

// ---------------- 记录（已完成 / 支出） ----------------

export interface RecordModalOptions {
  date: string;
  rec?: Rec;
  line?: number;
  defaults?: Partial<Rec>;
  taskDraft?: TaskModalOptions;
  /** 保存后回调；新增 / 修改时带上保存的记录，删除时不带 */
  onSaved?: (rec?: Rec) => void;
}

export class RecordModal extends Modal {
  private rec: Rec;
  private editing: boolean;
  private saving = false;
  private titleInput?: HTMLInputElement;
  private amountInput?: HTMLInputElement;
  private durationInput?: HTMLInputElement;
  private parsed: QuickParse | null = null;
  private lastTimeCat = "";

  constructor(app: App, private plugin: LubiPlugin, private opts: RecordModalOptions) {
    super(app);
    const s = plugin.settings;
    const firstCat = s.categories.find((c) => c.kind === "time")?.name || "日常";
    this.editing = !!opts.rec;
    this.rec = opts.rec
      ? { ...opts.rec, extra: { ...opts.rec.extra } }
      : {
          date: opts.date,
          start: opts.defaults?.start || (opts.date === todayStr() ? nowHM() : "09:00"),
          minutes: opts.defaults?.minutes ?? 30,
          estimatedMinutes: normalizeEstimatedMinutes(opts.defaults?.estimatedMinutes ?? (opts.defaults?.task ? plugin.tasks.byId(opts.defaults.task)?.estimate : undefined)),
          category: opts.defaults?.category || firstCat,
          title: opts.defaults?.title || "",
          task: opts.defaults?.task,
          amount: opts.defaults?.amount,
          expenseType: opts.defaults?.expenseType,
          notes: opts.defaults?.notes,
          extra: {},
        };
  }

  onOpen(): void {
    this.modalEl.addClass("lubi-modal");
    this.render(false);
    this.titleEl.tabIndex = 0;
    this.titleEl.focus({ preventScroll: true });
  }

  private render(focusTitle = false): void {
    const { contentEl, titleEl } = this;
    contentEl.empty();
    const s = this.plugin.settings;
    const cat = categoryOf(s, this.rec.category);
    const isMoney = cat.kind === "money";
    this.modalEl.addClass("lubi-record-modal");
    this.modalEl.style.setProperty("--chip", "var(--color-ink)");

    // 标题：带日期与原时间段
    titleEl.empty();
    titleEl.createSpan({ text: this.editing ? "编辑记录" : "新建" });
    const ctx = [`${shortDate(this.rec.date)} 周${weekdayZh(this.rec.date)}`];
    if (this.editing && this.opts.rec) ctx.push(this.opts.rec.minutes > 0 ? `${this.opts.rec.start}–${minToHM(hmToMin(this.opts.rec.start) + this.opts.rec.minutes)}` : this.opts.rec.start);
    titleEl.createSpan({ cls: "lubi-modal-ctx", text: ctx.join(" · ") });

    // 单一模式：记录时间 / 记录支出 / 规划任务
    const timeCats = s.categories.filter((c) => c.kind === "time");
    const moneyCats = s.categories.filter((c) => c.kind === "money");
    // 三种新建模式只保留一个互斥选择
    const modeRow = contentEl.createDiv({ cls: "lubi-mode-row" });
    if (!this.editing && isMoney) kindSwitch(modeRow, "money", (kind) => {
      if (kind === "todo") { this.switchToTask(); return; }
      if (kind === "money") {
        this.lastTimeCat = this.rec.category;
        this.rec.category = moneyCats[0]?.name || this.rec.category;
        if (this.rec.minutes === 30) this.rec.minutes = 0;
      } else {
        this.rec.category = this.lastTimeCat && timeCats.some((c) => c.name === this.lastTimeCat) ? this.lastTimeCat : (timeCats[0]?.name || this.rec.category);
        if (this.rec.minutes <= 0) this.rec.minutes = 30;
      }
      this.render(false);
      this.contentEl.querySelector<HTMLElement>('.lubi-kind-seg .lubi-seg-item[aria-pressed="true"]')?.focus();
    });

    // 分类：单行胶囊，Alt + 数字切换
    const pool = isMoney ? moneyCats : timeCats;
    let refreshNames = () => undefined as void;
    const pickCat = (name: string, focus = true) => {
      const next = categoryOf(s, name);
      if (next.kind !== cat.kind) return;
      this.rec.category = name;
      this.modalEl.style.setProperty("--chip", "var(--color-ink)");
      cats.querySelectorAll<HTMLButtonElement>(".lubi-cat-option").forEach((b) => {
        const on = b.dataset.cat === name;
        b.setAttribute("aria-pressed", String(on));
        if (on && focus) b.focus();
      });
      refreshNames();
    };
    const cats = contentEl.createDiv({ cls: "lubi-cat-picker lubi-cat-pills", attr: { role: "group", "aria-label": "分类" } });
    const markOverflow = () => cats.toggleClass("is-overflow", cats.scrollWidth - cats.scrollLeft - cats.clientWidth > 4);
    cats.addEventListener("scroll", markOverflow, { passive: true });
    window.requestAnimationFrame(markOverflow);
    cats.toggleClass("is-hidden", pool.length <= 1 && isMoney);
    pool.forEach((c, i) => {
      const b = tip(cats.createEl("button", { cls: "lubi-cat-option", attr: { type: "button", "aria-pressed": String(c.name === this.rec.category), "data-cat": c.name } }), i < 9 ? `${c.name}（Alt+${i + 1}）` : c.name);
      b.style.setProperty("--chip", "var(--color-ink)");
      icon(b, c.icon, "lubi-icon");
      b.createSpan({ text: c.name });
      if (i < 9) b.createSpan({ cls: "lubi-cat-key", text: String(i + 1), attr: { "aria-hidden": "true" } });
      b.addEventListener("click", (e) => {
        stopAll(e);
        pickCat(c.name);
      });
    });

    let syncTime: () => void = () => undefined;
    // 标题（支持一行输入：9:00-10:30 学习 三明治定理 / 30min 跑步）
    const titleRow = contentEl.createDiv({ cls: "lubi-field" });
    const titleLabel = titleRow.createEl("label", { text: isMoney ? "买了什么" : "做了什么" });
    const titleInput = titleRow.createEl("input", { type: "text", value: this.rec.title, attr: { placeholder: isMoney ? "午饭 / 地铁 / 书" : "做了什么 · 也可一行写完：9:00-10:30 学习 三明治定理", autocomplete: "off" } });
    associate(titleLabel, titleInput);
    this.titleInput = titleInput;
    const parseHint = titleRow.createDiv({ cls: "lubi-parse-preview", attr: { "aria-live": "polite" } });
    const applyParse = () => {
      this.parsed = isMoney ? null : parseQuick(titleInput.value, timeCats.map((c) => c.name));
      parseHint.empty();
      const q = this.parsed;
      if (!q) return;
      if (q.start) this.rec.start = q.start;
      if (q.minutes) this.rec.minutes = q.minutes;
      if (q.category) pickCat(q.category, false);
      syncTime();
      icon(parseHint, "sparkles", "lubi-icon");
      const bits: string[] = [];
      if (q.category) bits.push(q.category);
      if (q.start) bits.push(q.minutes ? `${q.start}–${minToHM(hmToMin(q.start) + q.minutes)}` : `${q.start} 开始`);
      if (q.minutes) bits.push(fmtDuration(q.minutes));
      parseHint.createSpan({ text: `识别为 ${bits.join(" · ")} ·「${q.title || "（还没写做了什么）"}」` });
    };
    titleInput.addEventListener("input", () => { this.rec.title = titleInput.value; clearFieldError(titleInput); applyParse(); });
    if (isMoney) {
      const dl = titleRow.createEl("datalist", { attr: { id: `${titleInput.id}-expense-suggest` } });
      titleInput.setAttribute("list", dl.id);
      refreshNames = () => { dl.empty(); for (const title of this.plugin.recentTitles(this.rec.category)) dl.createEl("option", { value: title }); };
      refreshNames();
    }
    if (!isMoney) refreshNames = nameSuggestions(titleInput, this.plugin, () => this.rec.category, title => {
      this.rec.title = title; this.parsed = null; parseHint.empty(); clearFieldError(titleInput);
    }).refresh;
    if (focusTitle) window.setTimeout(() => { if (titleInput.isConnected) titleInput.focus(); }, 20);

    // 时间联动条：开始 ── 时长 ── 结束
    if (!isMoney) {
      const bar = contentEl.createDiv({ cls: "lubi-timebar" });
      const startCell = bar.createDiv({ cls: "lubi-timebar-cell" });
      const startLabel = startCell.createEl("label", { text: "开始" });
      const startInput = startCell.createEl("input", { type: "time", value: this.rec.start });
      associate(startLabel, startInput);
      bar.createDiv({ cls: "lubi-timebar-seg" }).createSpan({ cls: "lubi-timebar-line" });
      const durCell = bar.createDiv({ cls: "lubi-timebar-dur" });
      const durLabel = durCell.createEl("label", { cls: "lubi-sr-only", text: "时长" });
      const durInput = durCell.createEl("input", { type: "number", attr: { min: "0", step: "5" } });
      associate(durLabel, durInput);
      this.durationInput = durInput;
      const unitBtn = durCell.createEl("button", { cls: "lubi-timebar-unit", text: "min" });
      bar.createDiv({ cls: "lubi-timebar-seg" }).createSpan({ cls: "lubi-timebar-line" });
      const endCell = bar.createDiv({ cls: "lubi-timebar-cell" });
      const endLabel = endCell.createEl("label", { text: "结束" });
      const endInput = endCell.createEl("input", { type: "time" });
      associate(endLabel, endInput);
      let unit: "min" | "h" = this.rec.minutes >= 60 && this.rec.minutes % 30 === 0 ? "h" : "min";

      const estimate = normalizeEstimatedMinutes(this.rec.estimatedMinutes);
      const summary = estimate !== undefined || this.rec.task ? contentEl.createDiv({ cls: "lubi-estimate-summary" }) : null;
      const values = estimate !== undefined ? summary!.createDiv({ cls: "lubi-estimate-values", attr: { "aria-live": "polite" } }) : null;
      if (values) tip(values, "预计是任务当次的计划快照，实际与偏差针对本条记录；多次记录时不要重复累加任务预计。");
      if (summary) summary.createDiv({ cls: "lubi-estimate-note", text: estimate === undefined
        ? (this.editing ? "这条历史记录没有预计用时快照，不用当前任务的预计值补算。" : "创建这条记录时，关联任务未填写预计用时，只记录实际时长。")
        : (this.editing ? "预计用时是当时的快照，不随任务调整改变；实际为本条记录的用时，保存前请核对。" : "预计用时会随记录保存为快照。初始时长来自计划，请核对实际用时。") });
      const syncEstimate = () => values?.setText(formatEstimateComparison(confirmed(this.rec)));
      const quick = contentEl.createDiv({ cls: "lubi-quick" });
      const chips: { m: number; el: HTMLButtonElement }[] = [];
      syncTime = () => {
        startInput.value = this.rec.start;
        endInput.value = minToHM(hmToMin(this.rec.start) + this.rec.minutes);
        durInput.value = unit === "h" ? String(Math.round((this.rec.minutes / 60) * 100) / 100) : String(this.rec.minutes);
        durInput.step = unit === "h" ? "0.25" : "5";
        unitBtn.setText(unit);
        syncEstimate();
        for (const c of chips) c.el.setAttribute("aria-pressed", String(c.m === this.rec.minutes));
      };
      startInput.addEventListener("change", () => {
        if (startInput.value) this.rec.start = startInput.value;
        syncTime();
      });
      durInput.addEventListener("input", () => {
        clearFieldError(durInput);
        const v = Number(durInput.value) || 0;
        this.rec.minutes = Math.max(0, Math.round(unit === "h" ? v * 60 : v));
        syncEstimate();
        endInput.value = minToHM(hmToMin(this.rec.start) + this.rec.minutes);
        for (const c of chips) c.el.setAttribute("aria-pressed", String(c.m === this.rec.minutes));
      });
      unitBtn.addEventListener("click", (e) => {
        stopAll(e);
        unit = unit === "h" ? "min" : "h";
        syncTime();
      });
      endInput.addEventListener("change", () => {
        if (!endInput.value) return;
        let diff = hmToMin(endInput.value) - hmToMin(this.rec.start);
        if (diff < 0) diff += 1440;
        this.rec.minutes = diff;
        syncTime();
      });
      for (const m of [15, 30, 45, 60, 90, 120]) {
        const b = quick.createEl("button", { cls: "lubi-quick-chip", text: fmtDuration(m) });
        b.addEventListener("click", (e) => {
          stopAll(e);
          this.rec.minutes = m;
          syncTime();
        });
        chips.push({ m, el: b });
      }
      // 「接着记」= 当前时刻（历史日为当天结束）之前最近一条记录的结束时间，而不是当天最晚的一条
      const before = this.rec.date === todayStr() ? hmToMin(nowHM()) : undefined;
      const prevEnd = this.plugin.lastEndOf(this.rec.date, before);
      if (prevEnd && !this.editing && prevEnd !== this.rec.start) {
        const b = tip(quick.createEl("button", { cls: "lubi-quick-chip lubi-quick-chip-accent", attr: { type: "button" } }), `从上一条记录的结束时间 ${prevEnd} 接着记`);
        icon(b, "corner-down-right", "lubi-icon");
        b.createSpan({ text: `从 ${prevEnd} 接着记` });
        b.addEventListener("click", (e) => {
          stopAll(e);
          this.rec.start = prevEnd;
          syncTime();
        });
      }
      syncTime();
    } else {
      const row = contentEl.createDiv({ cls: "lubi-field-row" });
      const timeF = row.createDiv({ cls: "lubi-field lubi-field-narrow" });
      const timeLabel = timeF.createEl("label", { text: "时间" });
      const startInput = timeF.createEl("input", { type: "time", value: this.rec.start });
      associate(timeLabel, startInput);
      startInput.addEventListener("change", () => (this.rec.start = startInput.value || this.rec.start));
      const amtF = row.createDiv({ cls: "lubi-field" });
      const amtLabel = amtF.createEl("label", { text: "金额" });
      const amtWrap = amtF.createDiv({ cls: "lubi-amount" });
      amtWrap.createSpan({ cls: "lubi-amount-cur", text: "¥" });
      const amt = amtWrap.createEl("input", { type: "number", value: this.rec.amount !== undefined ? String(this.rec.amount) : "", attr: { step: "0.01", placeholder: "0.00" } });
      associate(amtLabel, amt);
      this.amountInput = amt;
      amt.addEventListener("input", () => { this.rec.amount = amt.value === "" ? undefined : Number(amt.value); clearFieldError(amt); });
      const typeF = row.createDiv({ cls: "lubi-field" });
      const expenseLabel = typeF.createEl("label", { text: "类别" });
      const sel = typeF.createEl("select");
      associate(expenseLabel, sel);
      for (const t of s.expenseTypes) sel.createEl("option", { value: t, text: t });
      sel.value = this.rec.expenseType && s.expenseTypes.includes(this.rec.expenseType) ? this.rec.expenseType : s.expenseTypes[0];
      this.rec.expenseType = sel.value;
      sel.addEventListener("change", () => (this.rec.expenseType = sel.value));
    }

    // 可选字段：备注（ghost 按钮，点开才出现）；关联任务由勾选 / 新建自动维护，不再手动选
    const extras = contentEl.createDiv({ cls: "lubi-extras" });
    const toggles = extras.createDiv({ cls: "lubi-extras-toggles" });
    const fields = extras.createDiv({ cls: "lubi-extras-fields" });
    const optional = (key: "task" | "notes", label: string, iconName: string, build: (host: HTMLElement) => void, initiallyOpen: boolean) => {
      const tg = toggles.createEl("button", { cls: "lubi-ghost-btn" });
      icon(tg, iconName, "lubi-icon");
      tg.createSpan({ text: label });
      let box: HTMLElement | null = null;
      const open = () => {
        if (box) return;
        box = fields.createDiv({ cls: "lubi-field lubi-extra-field", attr: { "data-extra-name": label } });
        const head = box.createDiv({ cls: "lubi-extra-head" });
        head.createEl("label", { text: label });
        iconButton(head, "x", "收起", () => {
          box?.remove();
          box = null;
          tg.removeClass("is-open");
          if (key === "task") this.rec.task = undefined;
          else this.rec.notes = undefined;
        }, "lubi-icon-btn-sm lubi-push-right");
        build(box);
        tg.addClass("is-open");
      };
      tg.addEventListener("click", (e) => {
        stopAll(e);
        open();
        (box?.querySelector("select, textarea, input") as HTMLElement | null)?.focus();
      });
      if (initiallyOpen) open();
    };
    optional("notes", "备注", "sticky-note", (host) => {
      const notes = host.createEl("textarea", { attr: { rows: "2", placeholder: "补一句上下文", "aria-label": "备注" } });
      notes.value = this.rec.notes || "";
      notes.addEventListener("input", () => (this.rec.notes = notes.value.trim() || undefined));
    }, !!this.rec.notes);

    // 操作
    const actions = contentEl.createDiv({ cls: "lubi-modal-actions" });
    if (this.editing && this.opts.line !== undefined) {
      const del = actions.createEl("button", { cls: "lubi-text-btn lubi-text-btn-danger lubi-push-left", text: "删除" });
      del.addEventListener("click", (e) => {
        stopAll(e);
        new ConfirmModal(this.app, "删除这条记录？", `${this.rec.start} ${this.rec.category} · ${this.rec.title}`, async () => {
          this.close();
          await deleteRecord(this.plugin, this.opts.date, { rec: this.opts.rec!, line: this.opts.line! }, () => this.opts.onSaved?.());
        }, "删除").open();
      });
    }
    button(actions, "取消", () => this.close(), { cls: "lubi-btn-ghost" });
    const ok = button(actions, this.editing ? "保存" : "记下", () => void this.save(), { primary: true });
    ok.createSpan({ cls: "lubi-kbd", text: "⏎" });

    contentEl.onkeydown = (e) => {
      if (e.key === "Enter" && e.target === titleInput && !e.isComposing) {
        e.preventDefault();
        void this.save();
        return;
      }
      // Alt + 1…9 切换分类
      if (e.altKey && /^[1-9]$/.test(e.key) && pool[Number(e.key) - 1]) {
        e.preventDefault();
        pickCat(pool[Number(e.key) - 1].name, false);
      }
    };
    if (this.parsed === null && titleInput.value) applyParse();
  }

  /** 切到「待做」：带着已填的内容换成任务表单 */
  private switchToTask(): void {
    const s = this.plugin.settings;
    const title = (this.parsed ? this.parsed.title : this.rec.title).trim();
    const category = categoryOf(s, this.rec.category).kind === "time" ? this.rec.category : (this.lastTimeCat || "");
    const start = this.parsed?.start || this.opts.defaults?.start || "";
    const estimate = this.rec.minutes > 0 ? this.rec.minutes : 0;
    this.close();
    const draft = this.opts.taskDraft;
    new TaskModal(this.app, this.plugin, { ...draft, defaults: { ...(draft?.defaults || { category, date: this.rec.date, start, estimate }), title }, recordDate: draft?.recordDate || this.rec.date, onSaved: () => this.opts.onSaved?.() }).open();
  }

  private async save(): Promise<void> {
    if (this.saving) return;
    const r = this.rec;
    if (this.parsed) {
      r.title = this.parsed.title;
      this.parsed = null;
      if (this.titleInput) this.titleInput.value = r.title;
    }
    if (!r.title.trim()) {
      fieldError(this.titleInput, "先写一下做了什么");
      return;
    }
    const isMoney = categoryOf(this.plugin.settings, r.category).kind === "money";
    if (isMoney && (r.amount === undefined || isNaN(r.amount))) {
      fieldError(this.amountInput, "填一下金额");
      return;
    }
    if (!isMoney && r.minutes <= 0) {
      fieldError(this.durationInput, "时长需要大于 0");
      return;
    }
    // 在表单里看过并保存 = 已核对：去掉「待确认」
    if (r.extra && r.extra[PENDING_KEY] !== undefined) delete r.extra[PENDING_KEY];
    this.saving = true;
    try {
      let saved: Rec = r;
      if (this.editing && this.opts.line !== undefined) {
        await this.plugin.journal.update(this.opts.date, this.opts.line, r);
        if (this.opts.rec) await syncLinkedTask(this.plugin, this.opts.rec, r);
      } else saved = await addRecordAsDone(this.plugin, r);
      const original = this.opts.rec;
      if (!isMoney && (!this.editing || original?.title.trim() !== saved.title.trim() || original?.category !== saved.category))
        await this.plugin.rememberName(saved.category, saved.title);
      this.close();
      this.opts.onSaved?.({ ...saved, extra: { ...saved.extra } });
    } catch (e) {
      formError(this.contentEl, `无法保存：${(e as Error).message}`);
    } finally {
      this.saving = false;
    }
  }
}

// ---------------- 任务 ----------------

export interface TaskModalOptions {
  task?: Task;
  focusDate?: boolean;
  recordDate?: string;
  actualDefaults?: { minutes?: number; start?: string };
  actualRequired?: boolean;
  /** UI draft only; never persisted in TaskStore. */
  completeWithRecord?: boolean;
  /** Repeat occurrence may differ from the date of a later human review record. */
  completionDate?: string;
  quickActual?: boolean;
  onActualSaved?: (rec: Rec) => void | Promise<void>;
  defaults?: Partial<Task>;
  onSaved?: (t: Task) => void;
}

export class TaskModal extends Modal {
  private t: Task;
  private editing: boolean;
  private saving = false;
  private creatingProject = false;
  private titleInput?: HTMLInputElement;
  private repeatSelect?: HTMLSelectElement;
  private dateInput?: HTMLInputElement;
  private estimateInput?: HTMLInputElement;
  private estimateInvalid = false;
  private actualText = "";
  private actualStart = "";
  private actualDate: string;
  private actualEdited = false;
  private actualExisting: Rec | null = null;
  private actualReadOnly = false;
  private actualSummary = "";
  private actualLoading?: Promise<void>;
  private actualLoadError = "";
  private actualClosed = false;
  private actualRequest = 0;
  private actualBusy = false;
  private actualInput?: HTMLInputElement;
  private actualRefresh?: () => void;
  private saveButton?: HTMLButtonElement;
  private completeActual = false;
  private completionChoice?: HTMLElement;
  private completionInput?: HTMLInputElement;
  private completionLabel?: HTMLElement;
  private completionHint?: HTMLElement;
  private readonly initial: string;

  constructor(app: App, private plugin: LubiPlugin, private opts: TaskModalOptions) {
    super(app);
    this.editing = !!opts.task;
    this.t = opts.task ? { ...opts.task, repeat: { ...opts.task.repeat, days: [...opts.task.repeat.days] }, doneDates: [...opts.task.doneDates] } : blankTask(opts.defaults);
    if (!this.t.category) this.t.category = plugin.settings.categories.find((c) => c.kind === "time")?.name || "";
    this.actualDate = opts.recordDate || this.t.date || todayStr();
    this.actualText = opts.actualDefaults?.minutes ? fmtDuration(opts.actualDefaults.minutes) : "";
    this.actualStart = opts.actualDefaults?.start || "";
    this.actualEdited = !!this.actualText;
    this.completeActual = !!opts.completeWithRecord;
    this.initial = JSON.stringify(this.t);
  }

  private get lightPlanning(): boolean { return this.editing && !this.opts.actualRequired && !this.opts.actualDefaults; }

  /** 有未保存修改时，标题旁显示「● 未保存」 */
  private syncDirty(): void {
    const dirty = this.editing && (JSON.stringify(this.t) !== this.initial || this.actualEdited || this.completeActual);
    this.titleEl.querySelector(".lubi-dirty")?.toggleClass("is-on", dirty);
  }

  onOpen(): void {
    this.modalEl.addClass("lubi-modal");
    // 捕获阶段监听：子控件 stopPropagation 也能更新「未保存」
    const dirtyCheck = () => window.setTimeout(() => this.syncDirty(), 0);
    for (const ev of ["input", "change", "click"]) this.contentEl.addEventListener(ev, dirtyCheck, true);
    this.render(!!this.opts.focusDate);
    this.titleEl.tabIndex = 0;
    if (!this.opts.focusDate) {
      if (this.opts.actualRequired) (this.editing ? this.actualInput : this.titleInput)?.focus({ preventScroll: true });
      else this.titleEl.focus({ preventScroll: true });
    }
    if (!this.lightPlanning) this.actualLoading = this.loadActual();
  }

  onClose(): void { this.actualClosed = true; }

  private async loadActual(): Promise<void> {
    if (!this.editing) return;
    const request = ++this.actualRequest, date = this.actualDate;
    const restoreFocus = !!this.opts.actualRequired && this.contentEl.ownerDocument.activeElement === this.actualInput;
    this.actualBusy = true; this.actualRefresh?.();
    try {
      const found = await taskActualRows(this.plugin, this.t.id, date);
      if (this.actualClosed || request !== this.actualRequest) return;
      this.actualBusy = false;
      this.actualReadOnly = found.split || found.rows.length > 1;
      this.actualSummary = this.actualReadOnly ? `已有 ${found.rows.length} 段或跨日记录，请在时间轴分别编辑` : "";
      this.actualExisting = found.rows[0]?.rec || null;
      if (this.actualReadOnly) this.actualText = "";
      if (!this.actualEdited && this.actualExisting && !this.actualReadOnly) {
        const r = this.actualExisting;
        this.actualText = !isPending(r) || r.extra[PENDING_KEY] === "实际开始未核对" ? fmtDuration(r.minutes) : "";
        this.actualStart = isPending(r) ? "" : r.start;
        if (isPending(r)) this.actualSummary ||= "已有待确认记录，填写实际用时会更新原记录";
      }
      if (this.actualInput?.isConnected) {
        this.actualInput.value = this.actualText; this.actualInput.disabled = this.actualReadOnly;
        const start = this.contentEl.querySelector<HTMLInputElement>('[data-actual="start"]');
        if (start) { start.value = this.actualStart; start.disabled = this.actualReadOnly; }
        this.actualRefresh?.();
        const active = this.contentEl.ownerDocument.activeElement;
        if (restoreFocus && !this.actualReadOnly && (active === this.contentEl.ownerDocument.body || active === this.actualInput)) this.actualInput.focus({ preventScroll: true });
      }
    } catch (e) {
      if (this.actualClosed || request !== this.actualRequest) return;
      this.actualBusy = false;
      this.actualLoadError = (e as Error).message;
      if (!this.actualClosed) { formError(this.contentEl, `无法读取实际记录：${this.actualLoadError}`); this.actualRefresh?.(); }
    }
  }

  private render(focusTitle = false): void {
    const { contentEl, titleEl } = this;
    const lightMoreOpen = contentEl.querySelector<HTMLDetailsElement>(".lubi-light-more")?.open || false;
    const planningOpen = contentEl.querySelector<HTMLDetailsElement>(".lubi-time-plan-details")?.open || !!this.opts.focusDate;
    contentEl.empty();
    this.completionChoice = undefined; this.completionInput = undefined; this.completionLabel = undefined; this.completionHint = undefined; this.saveButton = undefined;
    const parent = this.t.parent ? this.plugin.tasks.byId(this.t.parent) : null;
    this.modalEl.addClass("lubi-record-modal", "lubi-task-modal");
    this.modalEl.toggleClass("lubi-time-entry", !!this.opts.actualRequired);
    this.modalEl.toggleClass("lubi-light-task", this.lightPlanning);
    const s = this.plugin.settings;
    this.modalEl.style.setProperty("--chip", "var(--color-ink)");
    titleEl.empty();
    titleEl.createSpan({ text: this.opts.actualRequired ? "记我的用时" : this.editing ? "编辑任务" : "新建任务" });
    if (parent && !this.t.project) titleEl.createSpan({ cls: "lubi-modal-ctx", text: this.plugin.tasks.pathOf(parent).map((p) => p.title).join(" / ") });
    titleEl.createSpan({ cls: "lubi-dirty", text: "● 未保存", attr: { "aria-live": "polite" } });
    this.syncDirty();
    if (!this.editing && !parent) {
      kindSwitch(contentEl, "todo", (kind) => { if (kind === "money") this.switchToRecord(kind); });
      if (this.opts.actualRequired) contentEl.querySelector("[data-lubi-focus=\"seg:todo\"] span")?.setText("记用时");
    }

    // 分类
    const cats = contentEl.createDiv({ cls: "lubi-cat-picker" });
    for (const c of s.categories.filter((c) => c.kind === "time")) {
      const b = cats.createEl("button", { cls: "lubi-cat-option", attr: { "aria-pressed": String(c.name === this.t.category) } });
      b.style.setProperty("--chip", "var(--color-ink)");
      icon(b, c.icon, "lubi-icon");
      b.createSpan({ text: c.name });
      b.addEventListener("click", (e) => {
        stopAll(e);
        this.t.category = c.name;
        this.render(false);
        (Array.from(contentEl.querySelectorAll<HTMLButtonElement>(".lubi-cat-option")).find((item) => item.textContent === c.name))?.focus();
      });
    }

    // 任务名
    const titleF = contentEl.createDiv({ cls: "lubi-field" });
    const titleLabel = titleF.createEl("label", { text: "任务" });
    const titleInput = titleF.createEl("input", { type: "text", value: this.t.title, attr: { placeholder: "要做什么" } });
    associate(titleLabel, titleInput);
    this.titleInput = titleInput;
    titleInput.addEventListener("input", () => { this.t.title = titleInput.value; clearFieldError(titleInput); });
    nameSuggestions(titleInput, this.plugin, () => this.t.category, title => { this.t.title = title; clearFieldError(titleInput); });
    if (focusTitle) window.setTimeout(() => {
      const target = this.opts.focusDate && this.dateInput?.isConnected ? this.dateInput : titleInput;
      if (target.isConnected) target.focus();
    }, 20);

    const repF = contentEl.createDiv({ cls: "lubi-field lubi-repeat-field" });
    const repLabel = repF.createEl("label", { text: "重复" });
    const repSel = repF.createEl("select", { cls: "lubi-repeat-select" });
    associate(repLabel, repSel);
    this.repeatSelect = repSel;
    const kinds: [RepeatKind, string][] = [
      ["none", "不重复"],
      ["daily", "每天"],
      ["weekly", "每周几"],
      ["monthly", "每月几号"],
    ];
    for (const [k, l] of kinds) repSel.createEl("option", { value: k, text: l });
    repSel.value = this.t.repeat.kind;
    repSel.addEventListener("change", () => {
      this.t.repeat.kind = repSel.value as RepeatKind;
      this.t.repeat.days = [];
      this.render(false);
      this.contentEl.querySelector<HTMLSelectElement>(".lubi-repeat-select")?.focus();
    });

    if (this.t.repeat.kind === "weekly") {
      const days = contentEl.createDiv({ cls: "lubi-days" });
      ["一", "二", "三", "四", "五", "六", "日"].forEach((l, i) => {
        const n = i + 1;
        const b = days.createEl("button", { cls: "lubi-quick-chip", text: `周${l}`, attr: { "aria-pressed": String(this.t.repeat.days.includes(n)) } });
        b.addEventListener("click", (e) => {
          stopAll(e);
          const has = this.t.repeat.days.includes(n);
          this.t.repeat.days = has ? this.t.repeat.days.filter((d) => d !== n) : [...this.t.repeat.days, n].sort();
          b.setAttribute("aria-pressed", String(!has));
        });
      });
    } else if (this.t.repeat.kind === "monthly") {
      const days = contentEl.createDiv({ cls: "lubi-days lubi-days-month" });
      for (let n = 1; n <= 31; n++) {
        const b = days.createEl("button", { cls: "lubi-quick-chip", text: String(n), attr: { "aria-pressed": String(this.t.repeat.days.includes(n)) } });
        b.addEventListener("click", (e) => {
          stopAll(e);
          const has = this.t.repeat.days.includes(n);
          this.t.repeat.days = has ? this.t.repeat.days.filter((d) => d !== n) : [...this.t.repeat.days, n].sort((a, b) => a - b);
          b.setAttribute("aria-pressed", String(!has));
        });
      }
    }

    const locationF = contentEl.createDiv({ cls: "lubi-field lubi-location-field" });
    const locationLabel = locationF.createEl("label", { text: "地点（可选）" });
    const location = locationF.createEl("input", { type: "text", value: this.t.location || "", attr: { placeholder: "如图书馆、教室；可留空", maxlength: "200", "data-task-location": "input" } });
    associate(locationLabel, location);
    location.addEventListener("input", () => { this.t.location = location.value.trim(); });

    contentEl.createEl("hr", { cls: "lubi-task-divider" });

    // 计划：日期和时间 → 预计用时
    const grid = contentEl.createDiv({ cls: "lubi-grid lubi-plan-grid" });
    if (this.t.repeat.kind === "none") {
      const dateF = grid.createDiv({ cls: "lubi-field" });
      const dateLabel = dateF.createEl("label", { text: "计划开始日期" });
      const date = dateF.createEl("input", { type: "date", value: this.t.date });
      associate(dateLabel, date);
      this.dateInput = date;
      date.addEventListener("change", () => (this.t.date = date.value));
    }
    const startF = grid.createDiv({ cls: "lubi-field" });
    startF.addClass("lubi-plan-start-field");
    const startLabel = startF.createEl("label", { text: "计划开始时间" });
    const start = startF.createEl("input", { type: "time", value: this.t.start });
    associate(startLabel, start);
    start.addEventListener("change", () => (this.t.start = start.value));
    const estF = grid.createDiv({ cls: "lubi-field lubi-plan-full-field" });
    const estLabel = estF.createEl("label", { text: executorOf(this.t) === "background" ? "预计本人投入" : "预计用时" });
    const estWrap = estF.createDiv({ cls: "lubi-timebar-dur lubi-timebar-dur-block" });
    const est = estWrap.createEl("input", { type: "text", value: this.t.estimate ? fmtDuration(this.t.estimate) : "", attr: { inputmode: "decimal", placeholder: "如 45min / 2.5h", autocomplete: "off" } });
    associate(estLabel, est);
    this.estimateInput = est;
    const estHint = estWrap.createSpan({ cls: "lubi-timebar-unit is-static" });
    const syncEst = () => {
      const v = parseEstimate(est.value);
      this.estimateInvalid = v === null;
      if (v !== null) this.t.estimate = v;
      estHint.setText(v === null ? "?" : v ? `${v} min` : "min");
    };
    syncEst();
    est.addEventListener("input", () => { clearFieldError(est); syncEst(); });
    est.addEventListener("blur", () => { if (!this.estimateInvalid && this.t.estimate) est.value = fmtDuration(this.t.estimate); });

    contentEl.createEl("hr", { cls: "lubi-task-divider" });

    const actualF = contentEl.createDiv({ cls: "lubi-field lubi-actual-field" });
    const actualLabel = actualF.createEl("label", { text: executorOf(this.t) === "background" ? "本人实际用时" : "实际用时" });
    const actual = actualF.createEl("input", { type: "text", value: this.actualText, attr: { placeholder: "本人花了多久，如 25min", inputmode: "decimal", "data-actual": "minutes" } });
    associate(actualLabel, actual); this.actualInput = actual; actual.disabled = this.actualReadOnly;
    const actualHint = contentEl.createDiv({ cls: "lubi-muted lubi-actual-hint", attr: { role: "status" } });
    const actualDetails = contentEl.createDiv({ cls: "lubi-actual-details" });
    const actualGrid = actualDetails.createDiv({ cls: "lubi-grid" });
    const actualDayF = actualGrid.createDiv({ cls: "lubi-field" }), actualDayL = actualDayF.createEl("label", { text: "实际开始日期" });
    const actualDay = actualDayF.createEl("input", { type: "date", value: this.actualDate, attr: { "data-actual": "date" } });
    associate(actualDayL, actualDay); actualDay.disabled = this.editing && !this.opts.actualRequired;
    actualDay.addEventListener("change", () => {
      if (this.saving) return;
      this.actualDate = actualDay.value;
      clearFieldError(actualDay);
      if (this.editing && this.opts.actualRequired) {
        // Switching days looks up that day's record; it never copies old effort to a new date.
        this.actualRequest++; this.actualText = ""; this.actualStart = ""; this.actualEdited = false;
        this.actualExisting = null; this.actualReadOnly = false; this.actualBusy = false; this.actualSummary = ""; this.actualLoadError = "";
        actual.value = "";
        const start = this.contentEl.querySelector<HTMLInputElement>('[data-actual="start"]');
        if (start) { start.value = ""; start.disabled = false; }
        if (isValidDate(this.actualDate)) this.actualLoading = this.loadActual();
        else fieldError(actualDay, "请选择有效的实际日期");
      } else this.actualEdited = true;
      syncActual();
    });
    const actualStartF = actualGrid.createDiv({ cls: "lubi-field" }), actualStartL = actualStartF.createEl("label", { text: "实际开始时间" });
    const actualStart = actualStartF.createEl("input", { type: "time", value: this.actualStart, attr: { "data-actual": "start" } });
    associate(actualStartL, actualStart); actualStart.disabled = this.actualReadOnly;
    actualStart.addEventListener("change", () => { this.actualStart = actualStart.value; this.actualEdited = true; syncActual(); });
    actualDetails.append(actualF);
    const syncActual = () => {
      const minutes = parseEstimate(this.actualText);
      const comparison = minutes && normalizeEstimatedMinutes(this.t.estimate) ? (formatEstimateComparison({ date: this.actualDate, start: this.actualStart || "00:00", minutes, estimatedMinutes: normalizeEstimatedMinutes(this.t.estimate), category: this.t.category, title: this.t.title, extra: {} }) || "") + (this.actualStart ? "" : " · 实际开始待核对") : "";
      const hint = this.actualReadOnly ? this.actualSummary : minutes ? comparison : this.actualSummary;
      actualHint.setText(hint); actualHint.hidden = !hint;
      const independent = !!this.opts.actualRequired && !this.editing;
      const hasActual = !!this.actualText.trim() || !!this.opts.actualRequired;
      const completed = this.plugin.tasks.isDoneOn(this.t, this.opts.completionDate || this.actualDate);
      if (independent || completed || (!this.actualText.trim() && !this.opts.actualRequired)) this.completeActual = false;
      if (this.saveButton) {
        const label = !this.actualReadOnly && hasActual ? this.completeActual ? executorOf(this.t) === "background" ? "保存用时并验收" : "保存用时并完成" : "保存用时" : "保存任务";
        this.saveButton.querySelector("span")?.setText(label);
        this.saveButton.disabled = !!this.opts.actualRequired && (this.actualReadOnly || this.actualBusy || !!this.actualLoadError || !isValidDate(this.actualDate));
      }
      actual.disabled = this.actualReadOnly || this.actualBusy;
      actualStart.disabled = this.actualReadOnly || this.actualBusy;
      if (this.completionChoice) this.completionChoice.hidden = independent || this.actualReadOnly || !hasActual;
      if (this.completionInput) { this.completionInput.checked = this.completeActual || completed; this.completionInput.disabled = this.actualReadOnly || completed; }
      this.completionLabel?.setText(completed ? "任务已经完成，补记不会改变完成状态" : executorOf(this.t) === "background" ? "这次也验收完成" : "这次也标记完成");
      this.completionHint?.setText(this.opts.completionDate && this.opts.completionDate !== this.actualDate ? `用时记在 ${this.actualDate}；勾选时完成 ${this.opts.completionDate} 的任务。` : "不勾选就只记用时；直接完成或验收不会自动记时。" );
      actualDetails.hidden = this.actualReadOnly && !this.opts.actualRequired;
      actualStartF.hidden = this.actualReadOnly && !!this.opts.actualRequired;
      if (this.actualReadOnly && !this.opts.actualRequired && actualF.parentElement === actualDetails) actualDetails.after(actualF);
      else if (!this.actualReadOnly && actualF.parentElement !== actualDetails) actualDetails.append(actualF);
    };
    actual.addEventListener("input", () => { this.actualText = actual.value; this.actualEdited = true; clearFieldError(actual); syncActual(); });
    this.actualRefresh = syncActual;
    est.addEventListener("input", syncActual); syncActual();

    // 可选：父任务 / 跨度 / 状态 / 备注
    const extras = contentEl.createDiv({ cls: "lubi-extras" });
    const toggles = extras.createDiv({ cls: "lubi-extras-toggles" });
    const fields = extras.createDiv({ cls: "lubi-extras-fields" });
    const optional = (label: string, iconName: string, build: (host: HTMLElement) => void, onClear: () => void, initiallyOpen: boolean) => {
      const tg = toggles.createEl("button", { cls: "lubi-ghost-btn" });
      icon(tg, iconName, "lubi-icon");
      tg.createSpan({ text: label });
      let box: HTMLElement | null = null;
      const open = () => {
        if (box) return;
        box = fields.createDiv({ cls: "lubi-field lubi-extra-field", attr: { "data-extra-name": label } });
        const head = box.createDiv({ cls: "lubi-extra-head" });
        head.createEl("label", { text: label });
        iconButton(head, "x", "收起", () => {
          box?.remove();
          box = null;
          tg.removeClass("is-open");
          if (!this.lightPlanning) onClear();
        }, "lubi-icon-btn-sm lubi-push-right");
        build(box);
        tg.addClass("is-open");
      };
      tg.addEventListener("click", (e) => {
        stopAll(e);
        open();
        (box?.querySelector("select, textarea, input") as HTMLElement | null)?.focus();
      });
      if (initiallyOpen) open();
    };
    optional("执行方式", "bot", (host) => {
      const select = host.createEl("select", { attr: { "aria-label": "执行方式", "data-task-executor": "select" } });
      select.createEl("option", { value: "self", text: "本人" });
      select.createEl("option", { value: "background", text: "Agent 后台（手动标注）" });
      select.value = executorOf(this.t);
      select.addEventListener("change", () => {
        this.t.executor = select.value as Executor;
        this.render(false);
        this.contentEl.querySelector<HTMLSelectElement>("[data-task-executor]")?.focus();
      });
      host.createDiv({ cls: "lubi-muted lubi-execution-note", text: "后台状态在任务行中手动标注，不会启动或控制 Agent。预计和实际用时均为本人投入；后台标注用时单独保存，不写入日记。" });
    }, () => undefined, executorOf(this.t) === "background");
    optional("项目", "folder", (host) => {
      const select = host.createEl("select", { attr: { "aria-label": "所属项目", "data-task-project": "select" } });
      const newProjectValue = `__lubi_create_${++fieldId}`;
      const refresh = () => { select.empty();select.createEl("option", { value: "", text: "不属于项目" }); for (const p of this.plugin.tasks.projectList) select.createEl("option", { value: p.id, text: p.title });if (this.lightPlanning) select.createEl("option", { value: newProjectValue, text: "＋ 创建新项目…", attr: { "data-project-create-option": "true" } });select.value = this.t.project || ""; };
      refresh();select.addEventListener("change", () => {
        if (this.lightPlanning && select.value === newProjectValue) { add.hidden = false; input.focus(); return; }
        this.t.project = select.value || undefined;this.t.parent = null;if (this.lightPlanning) add.hidden = true;
      });
      const add = host.createDiv({ cls: "lubi-inline lubi-project-create" });
      add.hidden = this.lightPlanning;
      const input = add.createEl("input", { type: "text", attr: { placeholder: "新项目名称", "aria-label": "新项目名称", maxlength: "200", "data-task-project": "name" } });
      const create = button(add, "创建项目", async () => {
        if (this.creatingProject || this.saving) return;create.disabled = true;this.creatingProject = true;select.disabled = true;input.disabled = true;
        try { const p = await this.plugin.tasks.addProject(input.value);if (this.actualClosed || !select.isConnected) return;this.t.project = p.id;this.t.parent = null;refresh();input.value = "";if (this.lightPlanning) add.hidden = true;this.syncDirty();select.focus(); }
        catch (e) { formError(this.contentEl, (e as Error).message); }
        finally { create.disabled = false;this.creatingProject = false;select.disabled = false;input.disabled = false; }
      }, { cls: "lubi-btn-sm" });
      if (this.lightPlanning) button(add, "取消新建", () => { add.hidden = true;input.value = "";refresh();select.focus(); }, { cls: "lubi-btn-sm" });
    }, () => { this.t.project = undefined;this.t.parent = null; }, this.lightPlanning || !!this.t.project);
    const spanLabel = this.t.repeat.kind === "none" ? "任务跨度" : "生效范围";
    optional(spanLabel, "calendar-range", (host) => {
      const row = host.createDiv({ cls: "lubi-grid lubi-grid-2" });
      const sdF = row.createDiv({ cls: "lubi-field" });
      const sdLabel = sdF.createEl("label", { text: this.t.repeat.kind === "none" ? "开始" : "从" });
      const sd = sdF.createEl("input", { type: "date", value: this.t.startDate });
      associate(sdLabel, sd);
      sd.addEventListener("change", () => (this.t.startDate = sd.value));
      const edF = row.createDiv({ cls: "lubi-field" });
      const edLabel = edF.createEl("label", { text: this.t.repeat.kind === "none" ? "截止" : "到" });
      const ed = edF.createEl("input", { type: "date", value: this.t.endDate });
      associate(edLabel, ed);
      ed.addEventListener("change", () => (this.t.endDate = ed.value));
    }, () => {
      this.t.startDate = "";
      this.t.endDate = "";
    }, !!(this.t.startDate || this.t.endDate));
    optional("状态", "circle-dot", (host) => {
      const row = host.createDiv({ cls: "lubi-inline" });
      const seg = row.createDiv({ cls: "lubi-seg lubi-status-seg", attr: { role: "group", "aria-label": "任务状态" } });
      // 改动反馈只靠选中态 + 标题旁的「● 未保存」，不再额外写一行说明
      for (const [v, l] of [["todo", "待办"], ["doing", "进行中"], ["done", "已完成"]] as [Task["status"], string][]) {
        const b = seg.createEl("button", { cls: "lubi-seg-item", attr: { type: "button", "data-task-status": v, "aria-pressed": String(this.t.status === v) } });
        b.createSpan({ cls: "lubi-status-check", text: "✓", attr: { "aria-hidden": "true" } });
        b.createSpan({ text: l });
        b.addEventListener("click", (e) => {
          stopAll(e);
          this.t.status = v;
          seg.querySelectorAll(".lubi-seg-item").forEach((x) => x.setAttribute("aria-pressed", "false"));
          b.setAttribute("aria-pressed", "true");
        });
      }
      const blocked = row.createEl("button", { cls: "lubi-quick-chip lubi-quick-chip-warn lubi-switch", attr: { type: "button", "aria-pressed": String(this.t.blocked) } });
      blocked.createSpan({ cls: "lubi-switch-track", attr: { "aria-hidden": "true" } }).createSpan({ cls: "lubi-switch-thumb" });
      blocked.createSpan({ text: "受阻" });
      tip(blocked, "受阻：被外部因素卡住，列表里会显示提示");
      blocked.addEventListener("click", (e) => {
        stopAll(e);
        this.t.blocked = !this.t.blocked;
        blocked.setAttribute("aria-pressed", String(this.t.blocked));
      });
    }, () => undefined, this.editing || this.t.blocked);
    optional("备注", "sticky-note", (host) => {
      const notes = host.createEl("textarea", { attr: { rows: "2", placeholder: "补一句上下文", "aria-label": "备注" } });
      notes.value = this.t.notes;
      notes.addEventListener("input", () => (this.t.notes = notes.value));
    }, () => (this.t.notes = ""), this.lightPlanning || !!this.t.notes);

    const completion = contentEl.createDiv({ cls: "lubi-completion-choice" });
    const completionRow = completion.createEl("label", { cls: "lubi-completion-row" });
    const completionInput = completionRow.createEl("input", { type: "checkbox", attr: { "data-actual-action": "complete" } });
    this.completionLabel = completionRow.createSpan();
    associate(completionRow, completionInput);
    this.completionChoice = completion; this.completionInput = completionInput;
    this.completionHint = completion.createDiv({ cls: "lubi-muted lubi-completion-hint", attr: { id: `lubi-completion-hint-${++fieldId}` } });
    completionInput.setAttribute("aria-describedby", this.completionHint.id);
    completionInput.addEventListener("change", () => { this.completeActual = completionInput.checked; syncActual(); this.syncDirty(); });

    const actions = contentEl.createDiv({ cls: "lubi-modal-actions" });
    if (this.editing && !this.opts.actualRequired) {
      const del = actions.createEl("button", { cls: "lubi-text-btn lubi-text-btn-danger lubi-push-left", text: "删除" });
      del.addEventListener("click", (e) => {
        stopAll(e);
        const original = this.plugin.tasks.byId(this.t.id) || this.t;
        new DeleteTaskModal(this.app, this.plugin, original, () => {
          this.close();
          this.opts.onSaved?.(this.t);
        }).open();
      });
    }
    button(actions, "取消", () => this.close(), { cls: "lubi-btn-ghost" });
    const ok = button(actions, "保存任务", () => void this.save(), { primary: true });
    ok.dataset.actualAction = "record";
    ok.dataset.lubiFocus = "task:save";
    this.saveButton = ok;
    ok.createSpan({ cls: "lubi-kbd", text: "⏎" });
    if (this.opts.actualRequired) {
      const independent = !this.editing;
      const context = !independent ? contentEl.createDiv({ cls: "lubi-time-task-context" }) : undefined;
      if (context) {
        context.createDiv({ cls: "lubi-time-task-title", text: this.t.title });
        const project = this.plugin.tasks.projectOf(this.t)?.title;
        context.createDiv({ cls: "lubi-muted", text: [project, this.t.category, this.opts.completionDate ? `任务发生日 ${this.opts.completionDate}` : undefined].filter(Boolean).join(" · ") });
        contentEl.prepend(context);
      }
      const nodes = Array.from(contentEl.children).filter(node => node !== context && (independent ? node !== cats && node !== titleF : true) && node !== actualHint && node !== actualDetails && node !== actualF && node !== completion && node !== actions && !node.classList.contains("lubi-kind-seg"));
      const planning = contentEl.createEl("details", { cls: "lubi-time-plan-details" });
      planning.open = planningOpen;
      planning.createEl("summary", { text: independent ? "可选：备注" : "可选：查看或调整任务计划" });
      if (independent) {
        for (const node of nodes) node.remove();
        const notes = planning.createEl("textarea", { attr: { rows: "2", "aria-label": "用时备注", placeholder: "补一句上下文" } });
        notes.value = this.t.notes;
        notes.addEventListener("input", () => { this.t.notes = notes.value; });
      } else for (const node of nodes) planning.append(node);
      contentEl.insertBefore(planning, completion);
    }
    syncActual();
    if (this.lightPlanning) arrangeLightTaskForm({
      host: contentEl, task: this.t, plugin: this.plugin, moreOpen: lightMoreOpen,
      title: titleF, categories: cats, grid, start: startF, extras, actions,
      actual: [actualF, actualDetails, actualHint, completion],
      onCategory: category => { this.t.category = category;this.render(false);this.syncDirty();this.contentEl.querySelector<HTMLSelectElement>("[data-light-category]")?.focus(); },
      onRecord: () => {
        if (JSON.stringify(this.t) !== this.initial) { new Notice("请先保存任务修改，再记录用时，避免丢失草稿。");return; }
        this.close();openUnifiedRecord(this.plugin, this.opts.recordDate || todayStr(), { task: this.t.id }, () => { this.plugin.refreshViews();this.opts.onSaved?.(this.plugin.tasks.byId(this.t.id) || this.t); }, this.opts.completionDate || this.opts.recordDate || this.t.date || todayStr());
      },
    });
    contentEl.onkeydown = (e) => {
      if (e.key === "Enter" && e.target === titleInput && !e.isComposing) {
        e.preventDefault();
        void this.save();
      }
    };
  }

  /** 切到「已完成 / 支出」：带着已填的内容换成记录表单 */
  private switchToRecord(kind: NewKind): void {
    const s = this.plugin.settings;
    const money = s.categories.find((c) => c.kind === "money")?.name;
    if (kind === "money" && !money) { new Notice("请先在设置中添加金钱分类"); return; }
    const date = this.opts.actualRequired ? this.actualDate : this.t.date || this.actualDate;
    const defaults: Partial<Rec> = kind === "money" && money
      ? { title: this.t.title, category: money, minutes: 0 }
      : { title: this.t.title, category: this.t.category || undefined, start: this.t.start || undefined, minutes: this.t.estimate || 30 };
    this.close();
    new RecordModal(this.app, this.plugin, { date, defaults, taskDraft: { ...this.opts, defaults: { ...this.t }, actualDefaults: { minutes: parseEstimate(this.actualText) || undefined, start: this.actualStart }, recordDate: this.actualDate, completeWithRecord: this.completeActual }, onSaved: () => this.opts.onSaved?.(this.t) }).open();
  }

  /** Merge untouched planning fields with the latest task; never overwrite a concurrent edit. */
  private currentDraft(): Task {
    if (!this.editing) return this.t;
    const latest = this.plugin.tasks.byId(this.t.id);
    if (!latest) throw new Error("任务已被删除，请重新打开");
    const original = JSON.parse(this.initial) as Record<string, unknown>;
    const current = latest as unknown as Record<string, unknown>;
    const merged = { ...current };
    for (const [key, value] of Object.entries(this.t)) {
      if (key === "updated" || JSON.stringify(value) === JSON.stringify(original[key])) continue;
      if (JSON.stringify(current[key]) !== JSON.stringify(original[key]) && JSON.stringify(current[key]) !== JSON.stringify(value)) throw new Error("任务已被其他操作修改，请重新打开后核对");
      merged[key] = value;
    }
    return merged as unknown as Task;
  }

  private async save(completeActual = this.completeActual): Promise<void> {
    if (this.saving || this.creatingProject) return;
    if (!this.editing && this.opts.quickActual) {
      const parsed = parseQuick(this.t.title, this.plugin.settings.categories.filter(c => c.kind === "time").map(c => c.name));
      if (parsed?.start && parsed.minutes === undefined && !this.actualText.trim()) { fieldError(this.actualInput, "已填写开始时间，请补填实际用时"); return; }
      if (parsed && (parsed.minutes || this.actualText.trim())) {
        this.t.title = parsed.title;
        if (parsed.category) this.t.category = parsed.category;
        if (!this.actualText.trim() && parsed.minutes) this.actualText = fmtDuration(parsed.minutes);
        if (!this.actualStart && parsed.start) this.actualStart = parsed.start;
        this.actualEdited = true;
      }
    }
    if (!this.t.title.trim()) {
      fieldError(this.titleInput, "任务名不能为空");
      return;
    }
    if (this.estimateInvalid) {
      fieldError(this.estimateInput, "预计时长写成 45min、2.5h 或 90 这样的格式");
      return;
    }
    if (this.actualLoadError) { formError(this.contentEl, "无法核对实际记录，请重新打开：" + this.actualLoadError); return; }
    const actualMinutes = parseEstimate(this.actualText);
    if (completeActual && (this.actualReadOnly || !actualMinutes || actualMinutes <= 0 || actualMinutes > 1440)) {
      fieldError(this.actualInput, "完成并记录需要真实用时；只标记完成请使用任务状态。"); return;
    }
    const writeActual = !this.actualReadOnly && !!this.actualText.trim() && (this.actualEdited || !this.actualExisting || completeActual);
    if ((this.opts.actualRequired && !this.actualText.trim()) || (this.actualEdited && this.actualExisting && !this.actualText.trim()) || (writeActual && (actualMinutes === null || actualMinutes <= 0 || actualMinutes > 1440))) {
      fieldError(this.actualInput, "实际用时须为 1–1440 分钟；已有记录请从时间轴删除"); return;
    }
    if (this.t.repeat.kind !== "none" && this.t.repeat.kind !== "daily" && !this.t.repeat.days.length) {
      fieldError(this.repeatSelect, "选一下重复的日子");
      return;
    }
    if (this.t.status === "done" && !this.t.doneAt) this.t.doneAt = new Date().toISOString();
    if (this.t.status !== "done") this.t.doneAt = "";
    // State edits never fabricate or delete actual records; explicit record actions are separate.
    const before = this.editing ? this.plugin.tasks.byId(this.t.id) : undefined;
    const originalStatus = this.editing ? JSON.parse(this.initial) as Task : undefined;
    const wasDone = !!originalStatus && originalStatus.repeat.kind === "none" && originalStatus.status === "done";
    const becomesDone = this.t.repeat.kind === "none" && this.t.status === "done" && !wasDone;
    const becomesUndone = wasDone && !(this.t.repeat.kind === "none" && this.t.status === "done");
    const undoneDate = before?.date || "";
    this.saving = true;
    const actualDate = this.actualDate, actualStart = this.actualStart;
    const actualDayControl = this.contentEl.querySelector<HTMLInputElement>('[data-actual="date"]');
    if (actualDayControl) actualDayControl.disabled = true;
    try {
      await this.actualLoading;
      if (this.actualLoadError) throw new Error(this.actualLoadError);
      if (this.editing && !this.plugin.tasks.byId(this.t.id)) throw new Error("任务已被删除，请重新打开");
      if (writeActual) {
        const result = await saveTaskActual(this.plugin, this.currentDraft(), actualDate, actualMinutes!, actualStart, this.actualExisting, this.opts.actualRequired && !this.editing ? undefined : normalizeEstimatedMinutes(this.t.estimate), { complete: completeActual, completionDate: this.opts.completionDate, independent: !!this.opts.actualRequired && !this.editing });
        try { await this.plugin.rememberName(result.task.category, result.task.title); } catch { new Notice("任务与实际记录已保存，但历史名称排序未更新"); }
        this.close(); this.opts.onSaved?.(result.task);
        try { await this.opts.onActualSaved?.(result.rec); } catch { new Notice("记录已保存，但后续刷新失败，请重新打开面板"); }
        return;
      }
      const nameChanged = !this.editing || before?.title.trim() !== this.t.title.trim() || before?.category !== this.t.category;
      const saved = await this.plugin.tasks.upsert(this.currentDraft());
      if (nameChanged) await this.plugin.rememberName(saved.category, saved.title);
      this.close();
      this.opts.onSaved?.(saved);
      const refresh = () => this.opts.onSaved?.(saved);
      if (becomesDone) {
        const date = saved.date || todayStr();
        await afterDone(this.plugin, saved, date, undefined, refresh);
        refresh();
      } else if (becomesUndone && undoneDate) {
        await afterUndone(this.plugin, saved.id, undoneDate, refresh);
        refresh();
      }
    } catch (e) {
      formError(this.contentEl, `无法保存：${(e as Error).message}`);
    } finally {
      this.saving = false;
      if (actualDayControl?.isConnected) actualDayControl.disabled = this.editing && !this.opts.actualRequired;
    }
  }
}

/** Public time-entry routes share the task form; the record editor remains for existing timeline records. */
export function openUnifiedRecord(plugin: LubiPlugin, date: string, defaults: Partial<Rec> = {}, onSaved?: (rec?: Rec) => void | Promise<void>, completionDate?: string): void {
  if ((defaults.category && categoryOf(plugin.settings, defaults.category).kind === 'money') || defaults.amount !== undefined) {
    new RecordModal(plugin.app, plugin, { date, defaults, onSaved }).open(); return;
  }
  const task = defaults.task ? plugin.tasks.byId(defaults.task) : undefined;
  if (defaults.task && !task) { new Notice("任务已不存在，请刷新后再记录"); return; }
  new TaskModal(plugin.app, plugin, {
    task, defaults: task ? undefined : { title: defaults.title || '', category: defaults.category || '', notes: defaults.notes || '', date },
    recordDate: date, completionDate: completionDate || (task ? date : undefined), actualRequired: true, quickActual: true,
    actualDefaults: task ? undefined : { minutes: defaults.minutes, start: defaults.start },
    onActualSaved: async rec => { await onSaved?.(rec); },
  }).open();
}
