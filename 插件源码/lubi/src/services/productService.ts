import { TFile, normalizePath } from 'obsidian';
import type LubiPlugin from '../main';
import { blankTask, Task } from '../core/tasks';
import { Rec, serializeRecord } from '../core/records';
import { backlog, parseRestore, pauseTimer, TimerSession, timerRecords } from '../core/productivity';
import { shiftDate, stamp, todayStr, uid, weekStart, isValidDate } from '../core/time';

export class ProductService {
  private busy = false;
  private undo?: { before: Task; after: Task }[];
  constructor(private plugin: LubiPlugin) {}
  private async lock<T>(run: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error('操作正在保存，请稍候');
    this.busy = true; try { return await run(); } finally { this.busy = false; }
  }
  async records(): Promise<Rec[]> {
    const rows: Rec[] = [];
    for (const date of this.plugin.journal.dates()) rows.push(...(await this.plugin.journal.read(date, true)).map(r => r.rec));
    return rows;
  }
  async arrange(observed: Task[], mode: 'date' | 'unschedule' | 'archive', date = ''): Promise<void> {
    return this.lock(async () => {
      if (!observed.length) throw new Error('请先选择任务');
      if (mode === 'date' && !isValidDate(date)) throw new Error('请选择有效日期');
      const allowed = new Set(backlog(this.plugin.tasks.all, todayStr()).map(t => t.id));
      if (observed.some(t => !allowed.has(t.id))) throw new Error('任务已不属于待整理列表，请刷新');
      const changes = observed.map(before => {
        const after = { ...before, updated: new Date().toISOString() };
        if (mode === 'archive') after.archived = true;
        else {
          const old = before.date;
          after.date = mode === 'date' ? date : ''; after.start = '';
          if (before.startDate && before.endDate && mode === 'date') {
            const days = Math.round((Date.parse(before.endDate) - Date.parse(before.startDate)) / 86400000);
            after.startDate = date; after.endDate = shiftDate(date, Math.max(0, days));
          } else { after.startDate = ''; after.endDate = ''; }
          if (old && old !== after.date) after.reschedules = (before.reschedules || 0) + 1;
        }
        return { before, after };
      });
      await this.plugin.tasks.productBatch(changes); this.undo = changes;
    });
  }
  async undoArrange(): Promise<void> {
    return this.lock(async () => {
      if (!this.undo) throw new Error('本次会话没有可撤销的整理');
      await this.plugin.tasks.productBatch(this.undo.map(c => ({ before: c.after, after: c.before })));
      this.undo = undefined;
    });
  }
  async split(before: Task, titles: string[]): Promise<void> {
    const names = titles.map(s => s.trim()).filter(Boolean);
    if (!names.length || names.length > 30 || names.some(s => s.length > 200)) throw new Error('请填写 1–30 个子行动，每行最多 200 字');
    return this.lock(async () => {
      if (before.repeat.kind !== 'none' || before.status === 'done') throw new Error('仅拆分未完成的一次性任务');
      const tasks = names.map(title => blankTask({ title, category: before.category, project: before.project, notes: `拆自：${before.title}（${before.id}）` }));
      await this.plugin.tasks.productBatch([{ before, after: { ...before, archived: true } }], tasks);
      this.undo = undefined;
    });
  }
  async startTimer(task: Task): Promise<void> {
    return this.lock(async () => {
      if (this.plugin.settings.focusTimer) throw new Error('已有计时，请先结束或放弃');
      await this.saveTimer({ id: uid(), task: task.id, title: task.title, category: task.category, segments: [], runningSince: Date.now() });
    });
  }
  async toggleTimer(): Promise<void> {
    return this.lock(async () => {
      const s = this.plugin.settings.focusTimer; if (!s) throw new Error('没有计时');
      await this.saveTimer(s.runningSince === undefined ? { ...s, runningSince: Date.now() } : pauseTimer(s));
    });
  }
  async discardTimer(): Promise<void> { return this.lock(() => this.saveTimer(undefined)); }
  private async saveTimer(s: TimerSession | undefined): Promise<void> {
    const old = this.plugin.settings.focusTimer; this.plugin.settings.focusTimer = s;
    try { await this.plugin.saveSettings(); } catch (e) { this.plugin.settings.focusTimer = old; throw e; }
  }
  async commitTimer(expectedId: string): Promise<void> {
    return this.lock(async () => {
      const s = this.plugin.settings.focusTimer;
      if (!s || s.id !== expectedId) throw new Error('计时会话已变化');
      const rows = timerRecords(s); if (!rows.length) throw new Error('没有完整分钟；请继续计时或放弃');
      // Per-segment stable markers make a partial save/restart safe to retry. Never complete a task.
      for (const rec of rows) {
        const existing = (await this.plugin.journal.read(rec.date, true)).filter(r => r.rec.extra['计时会话'] === rec.extra['计时会话']);
        if (existing.length) {
          if (existing.length !== 1 || serializeRecord(existing[0].rec) !== serializeRecord(rec)) throw new Error('已保存的计时记录被修改，请人工核对后放弃会话');
          continue;
        }
        await this.plugin.journal.add(rec);
      }
      await this.saveTimer(undefined); this.plugin.refreshViews();
    });
  }
  async saveReview(anchor: string, finding: string, actions: string[], category: string, createTasks: boolean, expected: string | null): Promise<string> {
    return this.lock(async () => {
      if (!isValidDate(anchor)) throw new Error('周日期无效');
      const week = weekStart(anchor), end = shiftDate(week, 6), path = `Lubi-复盘/${week}.md`;
      const lines = [...new Set(actions.map(x => x.trim()).filter(Boolean))];
      if (lines.length > 30 || lines.some(x => x.length > 200) || finding.length > 10000) throw new Error('复盘内容过长');
      if (createTasks && !this.plugin.settings.categories.some(c => c.kind === 'time' && c.name === category)) throw new Error('请选择有效分类');
      const existing = this.plugin.app.vault.getAbstractFileByPath(path);
      const before = existing instanceof TFile ? await this.plugin.app.vault.read(existing) : null;
      if (before !== expected) throw new Error('周报已变化，请重新打开后核对');
      // Stable IDs are based on exact action text; retries do not duplicate tasks, even after report failure.
      const tasks = lines.map(title => blankTask({ id: `review:${week}:${encodeURIComponent(title)}`, title, category, notes: `来自 [[Lubi-复盘/${week}]]` }));
      const additions = tasks.filter(t => !this.plugin.tasks.byId(t.id));
      if (createTasks && additions.length) await this.plugin.tasks.addBatch(additions);
      const recs = (await this.records()).filter(r => r.date >= week && r.date <= end && r.minutes > 0 && r.amount === undefined);
      const pending = recs.filter(r => r.extra['待确认']);
      const actual = recs.filter(r => !r.extra['待确认'] || r.extra['待确认'] === '实际开始未核对').reduce((n,r) => n+r.minutes,0);
      const text = `# 周复盘 ${week} — ${end}\n\n本人已记录投入：${actual} 分钟；有记录 ${new Set(recs.map(r=>r.date)).size}/7 天；待核对 ${pending.length} 条。\n记录不完整不代表效率下降；并行投入相加，不代表时间覆盖。\n\n## 本周发现\n${finding.trim()}\n\n## 下周行动\n${lines.map(l=>`- [ ] ${l}`).join('\n')}\n\n${createTasks ? '已按行动原文创建独立未安排任务；重复保存相同原文不会重复创建。' : '仅保存周报，未创建任务。'}\n`;
      await this.folder('Lubi-复盘');
      if (existing instanceof TFile) await this.plugin.app.vault.process(existing, current => { if (current !== before) throw new Error('周报在保存期间被修改；任务已创建，重试不会重复'); return text; });
      else await this.plugin.app.vault.create(path, text);
      return path;
    });
  }
  async restore(text: string): Promise<string> {
    return this.lock(async () => {
      const data = parseRestore(text), root = normalizePath(`Lubi-恢复-${stamp()}-${uid()}`);
      // Unique isolated directory only. Current tasks, journals and settings are never replaced.
      if (this.plugin.app.vault.getAbstractFileByPath(root)) throw new Error('恢复目录已存在，请重试');
      await this.folder(root);
      try {
        await this.plugin.app.vault.create(`${root}/原始导出.json`, text);
        await this.plugin.app.vault.create(`${root}/任务数据.json`, JSON.stringify(data.taskStore, null, 2) + '\n');
        await this.folder(`${root}/日记`);
        const grouped = new Map<string, Rec[]>();
        for (const r of data.records) { const list = grouped.get(r.date) || []; list.push(r); grouped.set(r.date,list); }
        for (const [date, recs] of grouped) await this.plugin.app.vault.create(`${root}/日记/${date}.md`, `# ${date}\n\n## 记录\n\n${recs.map(serializeRecord).join('\n')}\n`);
        await this.plugin.app.vault.create(`${root}/恢复说明.md`, '# 隔离恢复完成\n\n此目录没有替换当前数据，不是完整 Vault 备份。原始 JSON 保留未知字段；日记只重建导出的记录，不包含原日记其他章节。\n\n请将此目录复制到独立 Vault，安装 Lubi，将任务路径设为 `任务数据.json`、日记目录设为 `日记`，按原分类配置时间／支出类别后验证。当前插件不自动切换或合并。\n');
        return root;
      } catch (e) { throw new Error(`隔离恢复未完成：${(e as Error).message}；当前数据未修改。部分输出保留在 ${root}，请勿当作完整恢复。`); }
    });
  }
  private async folder(path: string): Promise<void> {
    if (!this.plugin.app.vault.getAbstractFileByPath(path)) await this.plugin.app.vault.createFolder(path);
  }
}
