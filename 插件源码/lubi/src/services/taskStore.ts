// Task store: loads, saves and backs up the task JSON file in the Vault. The task model lives in ../core/tasks.

import { App, Notice, TFile, normalizePath } from "obsidian";
import { LubiSettings } from "../settings";
import { isValidDate, stamp, uid } from "../core/time";
import { BackgroundPhase, backgroundRun, executorOf, prepareExecutionSave, withBackgroundPhase } from "../core/execution";
import { Project, Task, DoneLog, TaskStore, byOrder, byTime, occursOn, normalize, LegacyStore, migrateLegacy } from "../core/tasks";

export class Tasks {
  private store: TaskStore = { version: 14, tasks: [] };
  private loaded = false;
  private loadBlocked = false;
  private writing: Promise<void> = Promise.resolve();
  private diskText: string | null = null;
  lastImportBackup: string | null = null;
  /** 迁移发生时记录备份路径，供 UI 提示 */
  lastMigrationBackup: string | null = null;
  lastLoadError: string | null = null;
  /** 最近一次由本实例写入任务文件的时间，用于忽略自己的 Vault 事件。 */
  lastWriteAt = 0;
  onChange: (() => void) | null = null;

  constructor(private app: App, private settings: () => LubiSettings) {}

  get all(): Task[] {
    const containers = new Set(this.store.projectContainers || []);
    return this.store.tasks.filter(t => !containers.has(t.id) && !t.archived);
  }

  get projectList(): Project[] { return this.store.projects || []; }
  projectOf(task: Task): Project | undefined { return this.projectList.find(p => p.id === task.project); }
  lastProjectBackup: string | null = null;

  /** Copy-on-write mutations publish after conflict-checked persistence; project changes also back up. */
  private async storeChange<T>(change: (store: TaskStore) => T, backup = true, forceWrite = false): Promise<T> {
    await this.load();
    if (this.loadBlocked) throw new Error(this.lastLoadError || "任务数据不可写");
    let result!: T;
    const next = this.writing.catch(() => undefined).then(async () => {
      const p = this.filePath(), file = this.app.vault.getAbstractFileByPath(p);
      if (file && !(file instanceof TFile)) throw new Error("任务路径不是文件");
      const before = file instanceof TFile ? await this.app.vault.read(file) : null;
      if (before !== this.diskText) throw new Error("任务文件已在外部更新，请刷新后重试");
      const base = JSON.parse(JSON.stringify(this.store)) as TaskStore;
      const copy = JSON.parse(JSON.stringify(base)) as TaskStore;
      result = change(copy);
      const text = JSON.stringify(copy, null, 2);
      if ((!forceWrite && text === JSON.stringify(base, null, 2)) || text === before) return;
      if (file instanceof TFile) {
        if (backup) {
          const path = normalizePath(`${this.settings().backupFolder}/项目变更前-${stamp()}-${uid()}.json`);
          await ensureFolder(this.app, path.slice(0, path.lastIndexOf("/")));
          await this.app.vault.adapter.write(path, before!); this.lastProjectBackup = path;
        }
        if (file.path !== p) throw new Error("任务文件已被移动，未修改");
        this.lastWriteAt = Date.now();
        await this.app.vault.process(file, current => { if (current !== before) throw new Error("备份后任务文件已变化，未修改"); return text; });
      } else { await ensureFolder(this.app, p.slice(0, p.lastIndexOf("/"))); this.lastWriteAt = Date.now();await this.app.vault.create(p, text); }
      // Eager legacy task edits can be queued while this write is in flight. Keep their independent fields.
      const originals = new Map(base.tasks.map(t => [t.id, t]));
      const converted = new Map(copy.tasks.map(t => [t.id, t]));
      for (const current of this.store.tasks) {
        const original = originals.get(current.id), nextTask = converted.get(current.id);
        if (!original) { if (!nextTask) copy.tasks.push(current);continue; }
        if (!nextTask) continue;
        for (const [key, value] of Object.entries(current)) if (JSON.stringify(value) !== JSON.stringify((original as unknown as Record<string, unknown>)[key])) (nextTask as unknown as Record<string, unknown>)[key] = value;
      }
      const currentIds = new Set(this.store.tasks.map(t => t.id));
      copy.tasks = copy.tasks.filter(t => !originals.has(t.id) || currentIds.has(t.id));
      this.store = copy; this.diskText = text; this.lastWriteAt = Date.now();
    });
    this.writing = next; await next; this.onChange?.(); return result;
  }

  async addProject(title: string): Promise<Project> {
    title = title.trim(); if (!title || title.length > 200) throw new Error("项目名须为 1–200 字符");
    return this.storeChange(store => {
      store.projects ||= [];
      const found = store.projects.find(p => p.title === title); if (found) return found;
      const project = { id: uid(), title, created: new Date().toISOString() };store.projects.push(project);return project;
    });
  }

  /** Atomic, conflict-checked product edits. UI supplies observed task snapshots. */
  async productBatch(changes: { before: Task; after: Task }[], additions: Task[] = []): Promise<void> {
    await this.storeChange(store => {
      for (const c of changes) {
        const index = store.tasks.findIndex(t => t.id === c.before.id);
        if (index < 0 || JSON.stringify(store.tasks[index]) !== JSON.stringify(c.before)) throw new Error("任务已变化，请刷新后重试");
        if (c.after.id !== c.before.id) throw new Error("任务 ID 不可改变");
        store.tasks[index] = JSON.parse(JSON.stringify(c.after));
      }
      for (const t of additions) {
        if (store.tasks.some(x => x.id === t.id)) throw new Error("新增任务 ID 已存在");
        store.tasks.push(JSON.parse(JSON.stringify(t)));
      }
    }, false);
  }

  async setProjectBudget(id: string, budgetMinutes: number): Promise<void> {
    if (!Number.isFinite(budgetMinutes) || budgetMinutes < 0 || budgetMinutes > 6000000) throw new Error("预算无效");
    await this.storeChange(store => {
      const p = store.projects?.find(p => p.id === id); if (!p) throw new Error("项目不存在");
      p.budgetMinutes = Math.round(budgetMinutes);
    }, false);
  }

  /** Explicit conversion only: keep all task IDs and archival container data for record references. */
  async convertParentsToProjects(recordIds: Set<string>): Promise<number> {
    return this.storeChange(store => {
      const byId = new Map(store.tasks.map(t => [t.id, t]));
      if (byId.size !== store.tasks.length) throw new Error("任务 ID 重复，请先修复再转换");
      const parents = new Set(store.tasks.map(t => t.parent).filter((id): id is string => !!id && byId.has(id)));
      if (!parents.size) return 0;
      const root = (t: Task): Task => { const seen = new Set<string>(); while (t.parent && byId.has(t.parent)) { if (seen.has(t.id)) throw new Error("旧父任务关系存在循环，请先修复");seen.add(t.id);t = byId.get(t.parent)!; } return t; };
      store.projects ||= []; const mapping = new Map<string, Project>();
      for (const id of parents) { const r = root(byId.get(id)!); if (mapping.has(r.id)) continue; const project = store.projects.find(p => p.title === r.title) || { id: uid(), title: r.title, created: new Date().toISOString() }; if (!store.projects.includes(project)) store.projects.push(project);mapping.set(r.id, project); }
      const links = Object.fromEntries(store.tasks.filter(t => t.parent).map(t => [t.id, t.parent]));
      const assignments = new Map(store.tasks.map(t => [t.id, mapping.get(root(t).id)?.id]));
      const containers = new Set(store.projectContainers || []);
      for (const t of store.tasks) {
        if (assignments.get(t.id) && !t.project) t.project = assignments.get(t.id);
        if (parents.has(t.id) && !t.start && !t.estimate && !(t.startDate && t.endDate) && t.repeat.kind === "none" && !recordIds.has(t.id) && !Object.keys(t.doneLogs || {}).length && t.origin !== "record") containers.add(t.id);
        t.parent = null;
      }
      store.projectContainers = [...containers];
      const metadata = store as TaskStore & { legacyParentLinks?: Record<string, unknown> };
      if (metadata.legacyParentLinks && (typeof metadata.legacyParentLinks !== "object" || Array.isArray(metadata.legacyParentLinks))) throw new Error("旧关系存档格式异常，未转换");
      metadata.legacyParentLinks = { ...(metadata.legacyParentLinks || {}), ...links };
      return mapping.size;
    });
  }

  private filePath(): string {
    return normalizePath(this.settings().taskFile);
  }

  async load(force = false): Promise<void> {
    if (this.loaded && !force) return;
    const f = this.app.vault.getAbstractFileByPath(this.filePath());
    if (!(f instanceof TFile)) {
      this.store = { version: 14, tasks: [] };
      this.diskText = null;
      this.loaded = true;
      return;
    }
    const raw = await this.app.vault.read(f);
    this.diskText = raw;
    let data: unknown = null;
    try {
      data = JSON.parse(raw);
    } catch {
      const backup = normalizePath(`${this.settings().backupFolder}/损坏-任务数据-${stamp()}.json`);
      await ensureFolder(this.app, backup.slice(0, backup.lastIndexOf("/")));
      await this.app.vault.adapter.write(backup, raw);
      this.lastLoadError = `任务数据 JSON 无法解析，原文件已备份到 ${backup}`;
      this.loadBlocked = true;
      this.store = { version: 14, tasks: [] };
      this.loaded = true;
      new Notice(`${this.lastLoadError}。已进入只读保护，请修复后再继续操作。`, 10000);
      return;
    }
    this.loadBlocked = false;
    this.lastLoadError = null;
    const obj = (data || {}) as { version?: number; tasks?: unknown[] };
    if (obj.version === 14 && Array.isArray(obj.tasks)) {
      this.store = { ...obj, version: 14, tasks: obj.tasks.map((t) => normalize(t as Partial<Task>)) };
    } else if (Array.isArray(obj.tasks)) {
      // 旧版 (v13 及更早) → 先备份再迁移
      const backup = normalizePath(`${this.settings().backupFolder}/迁移前-任务数据-v${obj.version ?? 0}-${stamp()}.json`);
      await ensureFolder(this.app, backup.slice(0, backup.lastIndexOf("/")));
      await this.app.vault.adapter.write(backup, raw);
      this.lastMigrationBackup = backup;
      this.store = migrateLegacy(obj as LegacyStore);
      await this.persist();
    } else {
      this.store = { version: 14, tasks: [] };
    }
    this.loaded = true;
  }

  /** Read the saved store without normalizing, migrating, or dropping unknown fields. */
  async exportSnapshot(): Promise<TaskStore> {
    await this.writing;
    const file = this.app.vault.getAbstractFileByPath(this.filePath());
    if (!(file instanceof TFile)) {
      if (file || this.store.tasks.length) throw new Error("任务文件不可读取，请刷新后重试");
      return { version: 14, tasks: [] };
    }
    const data = JSON.parse(await this.app.vault.read(file)) as TaskStore | null;
    if (!data || data.version !== 14 || !Array.isArray(data.tasks)) throw new Error("任务文件格式异常，请先核对任务数据");
    return data;
  }

  private async persist(added: Task[] = []): Promise<void> {
    if (this.loadBlocked) throw new Error(this.lastLoadError || "任务数据无法写入：数据加载失败。");
    const next = this.writing.catch(() => undefined).then(async () => {
      const p = this.filePath();
      await ensureFolder(this.app, p.slice(0, p.lastIndexOf("/")));
      const f = this.app.vault.getAbstractFileByPath(p);
      if (added.length) {
        const ids = new Set(this.store.tasks.map(task => task.id));
        for (const task of added) { if (ids.has(task.id)) throw new Error("任务 ID 重复，未导入");ids.add(task.id); }
        if (f instanceof TFile) {
          const before = await this.app.vault.read(f);
          if (before !== this.diskText) throw new Error("任务文件已在外部更新，请刷新后重新导入");
          let raw: { version?: number; tasks?: unknown[] };
          try { raw = JSON.parse(before); } catch { throw new Error("任务文件 JSON 无效，未导入"); }
          if (raw?.version !== 14 || !Array.isArray(raw.tasks)) throw new Error("任务文件格式无效，未导入");
          const backup = normalizePath(`${this.settings().backupFolder}/导入前-任务数据-${stamp()}-${uid()}.json`);
          await ensureFolder(this.app, backup.slice(0, backup.lastIndexOf("/")));
          await this.app.vault.adapter.write(backup, before);this.lastImportBackup = backup;
          let text = "";
          this.lastWriteAt = Date.now();
          await this.app.vault.process(f, current => {
            if (current !== before) throw new Error("备份后任务文件已变化，未导入，请刷新重试");
            text = JSON.stringify({ ...this.store, tasks: [...this.store.tasks, ...added] }, null, 2);
            return text;
          });
          this.diskText = text;this.store.tasks.push(...added);return;
        }
        if (this.store.tasks.length) throw new Error("任务文件已被移除，请刷新后再导入");
      }
      const text = JSON.stringify({ ...this.store, tasks: [...this.store.tasks, ...added] }, null, 2);
      this.lastWriteAt = Date.now();
      if (f instanceof TFile) await this.app.vault.modify(f, text);
      else await this.app.vault.create(p, text);
      this.diskText = text;if (added.length) this.store.tasks.push(...added);
    });
    this.writing = next;
    await next;
  }

  /** Only new, validated tasks; one write, no in-memory publication on failure. */
  async addBatch(tasks: Task[]): Promise<void> {
    if (!tasks.length) throw new Error("没有可导入的任务");
    await this.load();
    if (tasks.some(t => t.project)) {
      await this.storeChange(store => {
        store.projects ||= []; const ids = new Set(store.tasks.map(t => t.id));
        for (const input of tasks) {
          if (ids.has(input.id)) throw new Error("任务 ID 重复，未导入"); ids.add(input.id);
          const t = { ...input };
          if (t.project) { const title = t.project.trim(); if (!title || title.length > 200) throw new Error("项目名无效"); let p = store.projects.find(p => p.id === title || p.title === title); if (!p) { p = { id: uid(), title, created: new Date().toISOString() };store.projects.push(p); } t.project = p.id;t.parent = null; }
          store.tasks.push(t);
        }
      });
      this.lastImportBackup = this.lastProjectBackup;
    } else await this.persist(tasks);
    this.onChange?.();
  }

  private async commit(): Promise<void> {
    await this.persist();
    this.onChange?.();
  }

  // ---------- 查询 ----------

  byId(id: string): Task | undefined {
    return this.store.tasks.find((t) => t.id === id);
  }

  children(id: string): Task[] {
    return this.all.filter((t) => t.parent === id).sort(byOrder);
  }

  roots(): Task[] {
    return this.all.filter((t) => !t.parent || !this.byId(t.parent)).sort(byOrder);
  }

  pathOf(task: Task): Task[] {
    const out: Task[] = [];
    let cur: Task | undefined = task;
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      out.unshift(cur);
      cur = cur.parent ? this.byId(cur.parent) : undefined;
    }
    return out;
  }

  isDoneOn(t: Task, date: string): boolean {
    return t.repeat.kind === "none" ? t.status === "done" : t.doneDates.includes(date);
  }

  /** 某天应出现的任务（安排在当天的 + 重复规则命中的） */
  forDate(date: string): Task[] {
    return this.all.filter((t) => occursOn(t, date)).sort(byTime);
  }

  /** 未安排的叶子任务（没有 date、非重复、未完成、没有子任务） */
  inbox(): Task[] {
    return this.all
      .filter((t) => !t.date && t.repeat.kind === "none" && t.status !== "done" && !this.children(t.id).length)
      .sort(byOrder);
  }

  /** 项目 = 顶层且有子任务，或设置了跨度 */
  projects(): Task[] {
    return this.roots().filter((t) => this.children(t.id).length > 0 || (t.startDate && t.endDate));
  }

  descendants(id: string): Task[] {
    const out: Task[] = [];
    const walk = (pid: string) => {
      for (const c of this.children(pid)) {
        out.push(c);
        walk(c.id);
      }
    };
    walk(id);
    return out;
  }

  progress(t: Task): { done: number; total: number } {
    const leaves = this.descendants(t.id).filter((d) => !this.children(d.id).length);
    if (!leaves.length) return { done: t.status === "done" ? 1 : 0, total: 1 };
    return { done: leaves.filter((l) => l.status === "done").length, total: leaves.length };
  }

  /** 项目的时间跨度：自身 startDate/endDate，否则由后代 date 推导 */
  span(t: Task): { from: string; to: string } | null {
    if (t.startDate && t.endDate) return { from: t.startDate, to: t.endDate };
    const dates = [t, ...this.descendants(t.id)].map((d) => d.date).filter(Boolean).sort();
    if (!dates.length) return null;
    return { from: t.startDate || dates[0], to: t.endDate || dates[dates.length - 1] };
  }

  // ---------- 变更 ----------

  async upsert(task: Task, completeParents = false): Promise<Task> {
    const now = Date.now();
    const draft = { ...task, updated: new Date(now).toISOString() };
    if (this.byId(task.id) !== task) task.updated = draft.updated;
    return this.storeChange(store => {
      const index = store.tasks.findIndex(t => t.id === draft.id);
      const saved = prepareExecutionSave(draft, store.tasks[index], now);
      if (saved.project) {
        if (!store.projects?.some(project => project.id === saved.project)) throw new Error("所属项目不存在，请重新选择");
        saved.parent = null;
      }
      if (index >= 0) store.tasks[index] = saved; else store.tasks.push(saved);
      if (completeParents && saved.status === "done" && saved.parent) this.autoCompleteParent(saved.parent, store);
      return saved;
    }, false, true);
  }

  /** Manual background annotation only: no command, AI request or journal write. */
  async setBackgroundPhase(id: string, date: string, phase: Exclude<BackgroundPhase, "accepted">): Promise<void> {
    if (!["ready", "running", "review"].includes(phase)) throw new Error("后台状态无效");
    await this.storeChange(store => {
      const index = store.tasks.findIndex(task => task.id === id);
      const task = store.tasks[index];
      if (!task) throw new Error("任务已不存在");
      if (executorOf(task) !== "background") throw new Error("请先将执行方式设为 Agent 后台");
      if (task.repeat.kind === "none" ? task.status === "done" : task.doneDates.includes(date)) throw new Error("这次任务已完成，请先取消完成");
      let saved = withBackgroundPhase(task, date, phase);
      if (saved === task) return;
      if (task.repeat.kind === "none") saved = { ...saved, status: phase === "ready" ? "todo" : "doing" };
      store.tasks[index] = { ...saved, updated: new Date().toISOString() };
    }, false);
  }

  async remove(id: string, withChildren = true): Promise<void> {
    await this.storeChange(store => {
      const ids = new Set([id]);
      if (withChildren) {
        let expanded = true;
        while (expanded) {
          expanded = false;
          for (const task of store.tasks) if (task.parent && ids.has(task.parent) && !ids.has(task.id)) { ids.add(task.id); expanded = true; }
        }
      }
      store.tasks = store.tasks.filter(task => !ids.has(task.id));
      if (!withChildren) for (const task of store.tasks) if (task.parent === id) task.parent = null;
    }, false);
  }

  /** Idempotent explicit completion, used by review acceptance and stale-safe checkboxes. */
  async setDone(id: string, date: string, done: boolean): Promise<boolean> {
    return this.completionChange(id, date, done);
  }

  async toggleDone(id: string, date: string): Promise<boolean> {
    return this.completionChange(id, date);
  }

  private async completionChange(id: string, date: string, requested?: boolean): Promise<boolean> {
    if (!isValidDate(date)) throw new Error("完成日期无效");
    return this.storeChange(store => {
      const index = store.tasks.findIndex(task => task.id === id);
      let task = store.tasks[index];
      if (!task) return false;
      const wasDone = this.isDoneOn(task, date), done = requested ?? !wasDone;
      if (done === wasDone) return done;
      if (task.repeat.kind === "none") {
        task.status = done ? "done" : "todo";
        task.doneAt = done ? new Date().toISOString() : "";
      } else {
        task.doneDates = done ? [...task.doneDates, date] : task.doneDates.filter(day => day !== date);
        if (done) task.skipDates = task.skipDates.filter(day => day !== date);
      }
      if (executorOf(task) === "background") {
        if (done) task = withBackgroundPhase(task, date, "accepted");
        else if (backgroundRun(task, date)?.phase === "accepted") task = withBackgroundPhase(task, date, "review");
      }
      task.updated = new Date().toISOString();
      store.tasks[index] = task;
      if (done && task.parent && !task.project) this.autoCompleteParent(task.parent, store);
      return done;
    }, false);
  }

  /** Legacy association metadata only; never permission to erase a real record. */
  async setDoneLog(id: string, date: string, log: DoneLog | null): Promise<void> {
    await this.storeChange(store => {
      const task = store.tasks.find(task => task.id === id);
      if (!task) return;
      const next = { ...task.doneLogs };
      if (log) next[date] = log;
      else if (next[date]) delete next[date];
      else return;
      task.doneLogs = Object.keys(next).length ? next : undefined;
      task.updated = new Date().toISOString();
    }, false);
  }

  /** 重复任务的单日例外：跳过 / 恢复当天，不改变重复规则。 */
  async toggleSkip(id: string, date: string): Promise<boolean> {
    const t = this.byId(id);
    if (!t || t.repeat.kind === "none") return false;
    const skipped = t.skipDates.includes(date);
    t.skipDates = skipped ? t.skipDates.filter((d) => d !== date) : [...t.skipDates, date];
    t.updated = new Date().toISOString();
    await this.commit();
    return !skipped;
  }

  private autoCompleteParent(pid: string, store: TaskStore = this.store, seen = new Set<string>()): void {
    if (seen.has(pid)) return;
    seen.add(pid);
    const parent = store.tasks.find(task => task.id === pid);
    // Background results always need an explicit human acceptance, including legacy parents.
    if (!parent || executorOf(parent) === "background") return;
    const archived = new Set(store.projectContainers || []);
    const children = store.tasks.filter(task => task.parent === pid && !archived.has(task.id));
    if (children.length && children.every(task => task.status === "done")) {
      parent.status = "done";
      parent.doneAt = new Date().toISOString();
      if (parent.parent) this.autoCompleteParent(parent.parent, store, seen);
    }
  }

  async schedule(id: string, date: string, start: string): Promise<void> {
    const t = this.byId(id);
    if (!t) return;
    t.date = date;
    t.start = start;
    t.updated = new Date().toISOString();
    await this.commit();
  }

  /** 取消某天的计划：一次性任务清除排期，重复任务只跳过当天。 */
  async cancelPlanOn(id: string, date: string): Promise<"cleared" | "skipped" | null> {
    const t = this.byId(id);
    if (!t) return null;
    if (t.repeat.kind !== "none") {
      await this.toggleSkip(id, date);
      return "skipped";
    }
    if (t.date !== date) return null;
    t.date = "";
    t.start = "";
    t.updated = new Date().toISOString();
    await this.commit();
    return "cleared";
  }

  async reorder(ids: string[]): Promise<void> {
    const original = new Map(ids.map(id => [id, this.byId(id)?.order]));
    ids.forEach((id, i) => {
      const t = this.byId(id);
      if (t) t.order = i + 1;
    });
    try { await this.commit(); }
    catch (e) {
      ids.forEach((id, i) => {
        const t = this.byId(id), order = original.get(id);
        if (t && order !== undefined && t.order === i + 1) t.order = order;
      });
      throw e;
    }
  }
}

async function ensureFolder(app: App, folder: string): Promise<void> {
  if (!folder) return;
  const parts = folder.split("/");
  let cur = "";
  for (const p of parts) {
    cur = cur ? `${cur}/${p}` : p;
    if (!(await app.vault.adapter.exists(cur))) await app.vault.createFolder(cur);
  }
}
