import { App, Modal } from "obsidian";
import type LubiPlugin from "../../main";
import { nameSuggestions } from "../nameSuggestions";
import { confirmed, formatEstimateComparison, normalizeEstimatedMinutes, PENDING_KEY, Rec } from "../../core/records";
import { hmToMin, minToHM, nowHM, todayStr, fmtDuration, shortDate, weekdayZh } from "../../core/time";
import { categoryOf } from "../../settings";
import { parseQuick, QuickParse } from "../../core/quickparse";
import { button, icon, iconButton, segmented, stopAll, tip } from "../components";
import { addRecordAsDone, deleteRecord, syncLinkedTask } from "../taskList";
import { associate, fieldError, clearFieldError, formError } from "./fields";
import { ConfirmModal } from "./confirm";
import { TaskModalOptions, TaskModal } from "./task";

// ---------------- 新建：记录 / 任务 共用一个入口 ----------------

/** done 仅用于内部记录编辑；新建入口只显示任务与支出。 */
export type NewKind = "done" | "money" | "todo";

/**
 * 新建窗口顶部只切换统一任务表单与支出表单。
 */
export function kindSwitch(host: HTMLElement, current: NewKind, onPick: (kind: NewKind) => void): void {
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
