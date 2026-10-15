import { Notice, Plugin, TFile, WorkspaceLeaf, normalizePath } from "obsidian";
import { DEFAULT_SETTINGS, LubiSettings, DEFAULT_CATEGORIES, migratePalette } from "./settings";
import { Journal } from "./services/journal";
import { Tasks } from "./services/taskStore";
import { detectLegacyJournals, migrateJournals } from "./services/migrate";
import { shiftDate, todayStr, minToHM, hmToMin, stamp, uid } from "./core/time";
import { DashboardView, VIEW_TYPE, Tab } from "./ui/view";
import { hideTip } from "./ui/components";
import { installTooltips } from "./ui/tooltips";
import { TaskModal, ConfirmModal } from "./ui/modals";
import { LubiSettingTab } from "./ui/settingsTab";
import { Rec } from "./core/records";
import { historyNames, validNameUses } from "./core/nameHistory";

import { ProductService } from "./services/productService";
import { ProductivityModal, ProductTab } from "./ui/productivity";

export default class LubiPlugin extends Plugin {
  settings: LubiSettings = DEFAULT_SETTINGS;
  journal!: Journal;
  tasks!: Tasks;
  product!: ProductService;
  /** 最近记录缓存：用于“接着记”；名称候选另行惰性读取全部历史。 */
  private recent: Rec[] = [];
  private nameRecords?: Promise<Rec[]>;
  private settingsWrite: Promise<void> = Promise.resolve();
  private disposeTooltips?: () => void;
  private refreshTimer: number | null = null;
  private pendingTaskReload = false;
  private pendingRecentRefresh = false;
  private exporting = false;

  async onload(): Promise<void> {
    this.disposeTooltips = installTooltips();
    await this.loadSettings();
    this.journal = new Journal(this.app, () => this.settings);
    this.tasks = new Tasks(this.app, () => this.settings);
    this.product = new ProductService(this);
    this.tasks.onChange = () => this.refreshViews(false);

    this.registerView(VIEW_TYPE, (leaf) => new DashboardView(leaf, this));
    this.addRibbonIcon("hourglass", "Lubi 记录", () => void this.activateView()).addClass("lubi-tooltip-scope");
    this.addSettingTab(new LubiSettingTab(this.app, this));

    this.addCommand({ id: "open", name: "打开面板", callback: () => void this.activateView() });
    this.addCommand({ id: "log", name: "新建任务 / 支出", callback: () => this.quickLog() });
    this.addCommand({ id: "open-today", name: "打开计划 · 今天", callback: () => void this.activateView("today", todayStr()) });
    this.addCommand({ id: "open-review", name: "打开面板 · 回顾页", callback: () => void this.activateView("review") });
    this.addCommand({ id: "open-tasks", name: "打开面板 · 计划页", callback: () => void this.activateView("tasks") });
    this.addCommand({ id: "open-journal", name: "打开今天的日记文件", callback: () => void this.openJournal(todayStr()) });
    this.addCommand({ id: "migrate", name: "迁移旧版数据", callback: () => void this.runMigration(true) });
    // Preserve the existing command ID so assigned export hotkeys continue to work.
    this.addCommand({ id: "export-csv", name: "导出数据 JSON", callback: () => void this.exportJson() });

    const productCommands: [ProductTab, string][] = [["cost", "投入与成果"], ["review", "周复盘行动"], ["backlog", "整理逾期任务"], ["timer", "实时计时"], ["restore", "隔离数据恢复"]];
    for (const [tab, name] of productCommands) this.addCommand({ id: "product-" + tab, name, callback: () => this.openProduct(tab) });

    // 日记或任务文件被外部修改 → 刷新
    this.registerEvent(this.app.vault.on("modify", (f) => this.onFileChange(f.path)));
    this.registerEvent(this.app.vault.on("create", (f) => this.onFileChange(f.path)));
    this.registerEvent(this.app.vault.on("delete", (f) => this.onFileChange(f.path)));
    this.registerEvent(this.app.vault.on("rename", (f, old) => { this.onFileChange(f.path); this.onFileChange(old); }));

    this.app.workspace.onLayoutReady(() => {
      void this.tasks.load().then(() => {
        if (this.tasks.lastMigrationBackup) new Notice(`任务数据已升级到 v14，旧文件备份在 ${this.tasks.lastMigrationBackup}`, 8000);
        void this.warmRecent();
        void this.runMigration(false);
      });
    });
  }

  onunload(): void {
    this.disposeTooltips?.();
    this.disposeTooltips = undefined;
    hideTip();
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    // Obsidian 会自行分离视图
  }

  // ---------- 设置 ----------

  async loadSettings(): Promise<void> {
    const raw = (await this.loadData()) as Partial<LubiSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(raw || {}) };
    if (raw?.aiApiKey) new Notice("检测到旧版明文 AI Key：本次会话暂时可用。保存任意插件设置后将从设置文件移除；之后只在当前会话填写。请检查历史备份／同步副本。", 12000);
    if (!Array.isArray(this.settings.categories) || !this.settings.categories.length) this.settings.categories = DEFAULT_CATEGORIES.map((c) => ({ ...c }));
    // 旧数据没有 paletteVersion：按 v1 处理，把仍是旧默认值的分类色迁移到 v1.4 色板（自定义颜色不动）。
    if (raw && raw.paletteVersion === undefined) this.settings.paletteVersion = 1;
    this.settings.nameUses = validNameUses(this.settings.nameUses);
    if (raw && migratePalette(this.settings)) await this.persistSettings();
  }

  async saveSettings(): Promise<void> {
    this.nameRecords = undefined;
    await this.persistSettings();
    this.refreshViews();
  }

  private persistSettings(): Promise<void> {
    const snapshot = JSON.parse(JSON.stringify({ ...this.settings, aiApiKey: "" }));
    const next = this.settingsWrite.catch(() => undefined).then(() => this.saveData(snapshot));
    this.settingsWrite = next;
    return next;
  }

  openProduct(tab: ProductTab = "cost"): void { new ProductivityModal(this, tab).open(); }

  openSettings(): void {
    const s = (this.app as unknown as { setting?: { open: () => void; openTabById: (id: string) => void } }).setting;
    s?.open();
    s?.openTabById(this.manifest.id);
  }

  // ---------- 视图 ----------

  private views(): DashboardView[] {
    return this.app.workspace.getLeavesOfType(VIEW_TYPE).map((l) => l.view).filter((v): v is DashboardView => v instanceof DashboardView);
  }

  refreshViews(refreshRecent = true): void {
    if (refreshRecent) void this.warmRecent();
    for (const v of this.views()) v.refresh();
  }

  async activateView(tab?: Tab | "today", date?: string): Promise<DashboardView | null> {
    let leaf: WorkspaceLeaf | null = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0] || null;
    if (!leaf) {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    void this.app.workspace.revealLeaf(leaf);
    const view = leaf.view instanceof DashboardView ? leaf.view : null;
    if (view && (tab || date)) view.show(tab, date);
    return view;
  }

  openTab(tab: Tab): void {
    void this.activateView(tab);
  }

  openDate(date: string, tab: Tab | "today" = "today"): void {
    void this.activateView(tab, date);
  }

  async openJournal(date: string): Promise<void> {
    const f = await this.journal.ensure(date);
    await this.app.workspace.getLeaf("tab").openFile(f);
  }

  async exportJson(): Promise<void> {
    if (this.exporting) return;
    this.exporting = true;
    try {
      const taskStore = await this.tasks.exportSnapshot();
      const records: Rec[] = [];
      for (const date of this.journal.dates()) {
        for (const row of await this.journal.read(date, true)) records.push(row.rec);
      }
      const data = { format: "lubi-data", version: 1, exportedAt: new Date().toISOString(), taskStore, records };
      const path = normalizePath(`Lubi-导出-${stamp()}-${uid()}.json`);
      await this.app.vault.create(path, `${JSON.stringify(data, null, 2)}\n`);
      const visible = taskStore.tasks.filter(t => !(taskStore.projectContainers || []).includes(t.id)).length;
      new Notice(`已导出 ${taskStore.projects?.length || 0} 个项目、${visible} 个任务、${records.length} 条记录：${path}`, 8000);
    } catch (e) {
      new Notice(`导出失败：${(e as Error).message}。原数据未修改。`, 8000);
    } finally {
      this.exporting = false;
    }
  }

  /** 新建：有面板时交给面板（任务页默认「待做」，其他页默认「已完成」），否则记今天的一条 */
  quickLog(): void {
    const v = this.views()[0];
    if (v) { v.openNew(); return; }
    new TaskModal(this.app, this, { defaults: { date: todayStr() }, recordDate: todayStr(), quickActual: true, onSaved: () => this.refreshViews() }).open();
  }

  shiftDate(date: string, days: number): string {
    return shiftDate(date, days);
  }

  private onFileChange(path: string): void {
    const p = normalizePath(path);
    const inJournal = p.startsWith(normalizePath(this.settings.journalFolder) + "/");
    if (inJournal) {
      this.nameRecords = undefined;
      // 内部编辑需要立即让当前交互看到最新结果，但不必再次扫描最近 14 天日记。
      if (Date.now() - this.journal.lastWriteAt < 1000) {
        this.refreshViews(false);
        return;
      }
      this.pendingRecentRefresh = true;
      this.scheduleRefresh();
    } else if (p === normalizePath(this.settings.taskFile)) {
      // Tasks.persist() 已经在写入前标记时间；不要因为自己的 modify 事件再次 load(true)，
      // 否则拖拽后的短时间内可能把内存中的最新任务状态重新读成旧快照。
      if (Date.now() - this.tasks.lastWriteAt < 1000) return;
      this.pendingTaskReload = true;
      this.scheduleRefresh();
    }
  }

  /** 合并同一批 Vault 事件，避免一次编辑触发多次全量渲染。 */
  private scheduleRefresh(): void {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      const reloadTasks = this.pendingTaskReload;
      const refreshRecent = this.pendingRecentRefresh;
      this.pendingTaskReload = false;
      this.pendingRecentRefresh = false;
      if (reloadTasks) void this.tasks.load(true).then(() => this.refreshViews(refreshRecent));
      else this.refreshViews(refreshRecent);
    }, 120);
  }

  // ---------- 联想 / 接着记 ----------

  private async warmRecent(): Promise<void> {
    const dates = this.journal.dates().slice(-14);
    const map = await this.journal.readRange(dates);
    this.recent = [...map.values()].flat();
  }

  /** Existing native expense suggestions; the time-name feature does not change this path. */
  recentTitles(category: string): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of this.recent.slice().reverse()) {
      if (r.category !== category || seen.has(r.title)) continue;
      seen.add(r.title); out.push(r.title);
      if (out.length >= 12) break;
    }
    return out;
  }

  /** Lazy full-history scan, shared by forms; invalidated by journal changes. */
  async nameCandidates(category: string): Promise<string[]> {
    if (!this.settings.categories.some(c => c.name === category && c.kind === "time")) return [];
    if (!this.nameRecords) {
      const pending = this.journal.readRange(this.journal.dates()).then(map => [...map.values()].flat());
      this.nameRecords = pending;
      pending.catch(() => { if (this.nameRecords === pending) this.nameRecords = undefined; });
    }
    const [records] = await Promise.all([this.nameRecords, this.tasks.load()]);
    return historyNames(category, records, this.tasks.all, validNameUses(this.settings.nameUses));
  }

  /** Called only after a successful form save. Failure must not invite a duplicate data save. */
  async rememberName(category: string, title: string): Promise<void> {
    if (!this.settings.categories.some(c => c.name === category && c.kind === "time")) return;
    const name = title.trim();
    if (!name) return;
    this.nameRecords = undefined;
    this.settings.nameUses = validNameUses(this.settings.nameUses).filter(u => u.category !== category || u.title !== name);
    this.settings.nameUses.push({ category, title: name, usedAt: Date.now() });
    try { await this.persistSettings(); }
    catch { new Notice("内容已保存，但名称排序未能保存；请检查插件存储权限。", 6000); }
  }

  /** 某天最后一条记录的结束时间（用于"接着记"） */
  /** 「接着记」的起点：取不晚于 before（分钟）的最近一条记录的结束时间；不传 before 则取当天最晚结束。 */
  lastEndOf(date: string, before?: number): string | null {
    const ends = this.recent
      .filter((r) => r.date === date && r.minutes > 0)
      .map((r) => hmToMin(r.start) + r.minutes)
      .filter((end) => end < 1440 && (before === undefined || end <= before));
    if (!ends.length) return null;
    return minToHM(Math.max(...ends));
  }

  // ---------- 迁移 ----------

  async runMigration(explicit: boolean): Promise<void> {
    // Startup skips the full journal scan once a scan found nothing; the command always scans.
    if (!explicit && this.settings.legacyScanDone) return;
    const legacy = await detectLegacyJournals(this.app, this.settings);
    if (!legacy.length) {
      if (!this.settings.legacyScanDone) {
        this.settings.legacyScanDone = true;
        await this.persistSettings();
      }
      if (explicit) new Notice("没有需要迁移的日记文件。");
      return;
    }
    const go = async () => {
      const r = await migrateJournals(this.app, this.settings);
      new Notice(`已迁移 ${r.files} 个日记文件、${r.records} 条记录。备份：${r.backupFolder}`, 10000);
      this.refreshViews();
    };
    if (explicit) await go();
    else new ConfirmModal(this.app, "发现旧版日记格式", `${legacy.length} 个日记文件仍是旧版 HTML 卡片。现在转换为新格式？（会先整份备份）`, () => void go(), "转换", false).open();
  }

  fileFor(path: string): TFile | null {
    const f = this.app.vault.getAbstractFileByPath(path);
    return f instanceof TFile ? f : null;
  }
}
