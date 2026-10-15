/** Product calculations are pure; no inferred actuals, budget snapshots or network access. */
import type { Task, TaskStore } from './tasks';
import { Rec, isPending, serializeRecord } from './records';
import { dateStr, isValidDate, minToHM } from './time';

export interface Delivery { at: string; link: string; outcome: 'submitted' | 'accepted' | 'rework'; reason: string; }
export interface TaskOutcome { links: string[]; criteria: { text: string; done: boolean }[]; history: Delivery[]; }
export interface TimerSession { id: string; task: string; title: string; category: string; segments: { from: number; to: number }[]; runningSince?: number; }
export function effort(records: Rec[], ids: Set<string>): { actual: number; pending: number; rows: Rec[] } {
  const rows = records.filter(r => !!r.task && ids.has(r.task) && Number.isFinite(r.minutes) && r.minutes > 0 && r.amount === undefined);
  let actual = 0, pending = 0;
  for (const r of rows) {
    if (isPending(r) && r.extra['待确认'] !== '实际开始未核对') pending += r.minutes;
    else actual += r.minutes;
  }
  return { actual, pending, rows };
}
export function validBudget(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 6000000) throw new Error('预算须为 0–6000000 分钟；0 表示未设置');
  return Math.round(value);
}
export function safeLink(value: string): boolean {
  return /^\[\[[^\r\n\]]+\]\]$/.test(value) || /^https?:\/\//i.test(value) && (() => { try { const u = new URL(value); return !u.username && !u.password; } catch { return false; } })();
}
export function validateOutcome(o: TaskOutcome): void {
  if (o.links.length > 50 || o.criteria.length > 100 || o.history.length > 500) throw new Error('关联／验收条目过多');
  if (o.links.some(l => !safeLink(l))) throw new Error('链接只支持 [[笔记或区块]] 或 http(s) 地址');
  if (o.criteria.some(c => !c.text.trim() || c.text.length > 500)) throw new Error('验收项须为 1–500 字符');
  if (o.history.some(h => !Number.isFinite(Date.parse(h.at)) || !['submitted','accepted','rework'].includes(h.outcome) || h.reason.length > 2000 || (h.link && !safeLink(h.link)) || (h.outcome === 'rework' && !h.reason.trim()))) throw new Error('交付记录无效；返工必须写原因');
}
export function backlog(tasks: Task[], today: string): Task[] {
  return tasks.filter(t => !t.archived && t.origin !== 'record' && t.status !== 'done' && t.repeat.kind === 'none' && (!t.date || (t.endDate || t.date) < today));
}
export function timerElapsed(s: TimerSession, now = Date.now()): number {
  return s.segments.reduce((n, p) => n + Math.max(0, p.to - p.from), 0) + (s.runningSince === undefined ? 0 : Math.max(0, now - s.runningSince));
}
export function pauseTimer(s: TimerSession, now = Date.now()): TimerSession {
  if (s.runningSince === undefined) return s;
  if (now < s.runningSince) throw new Error('系统时间倒退，请核对或放弃此次计时');
  return { ...s, segments: [...s.segments, { from: s.runningSince, to: now }], runningSince: undefined };
}
/** Split paused spans at local midnight, keeping pauses out of actual records. Sub-minute tails are omitted. */
export function timerRecords(s: TimerSession): Rec[] {
  if (s.runningSince !== undefined) throw new Error('请先暂停计时');
  const rows: Rec[] = [];
  if (s.segments.length > 1000) throw new Error('计时分段过多，请核对');
  for (const [i, span] of s.segments.entries()) {
    if (!Number.isFinite(span.from) || !Number.isFinite(span.to) || span.to < span.from || span.to - span.from > 7 * 86400000) throw new Error('计时跨度异常，请放弃后手工核对');
    let cursor = span.from, part = 0;
    while (cursor < span.to) {
      const d = new Date(cursor), midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
      const end = Math.min(span.to, midnight), minutes = Math.floor((end - cursor) / 60000);
      if (minutes > 1440) throw new Error('当日跨度异常，请手工核对');
      if (minutes > 0) rows.push({ date: dateStr(d), start: minToHM(d.getHours() * 60 + d.getMinutes()), minutes, title: s.title, category: s.category, task: s.task || undefined, extra: { '计时会话': `${s.id}:${i}:${part}` } });
      cursor = end; part++;
    }
  }
  return rows;
}
export interface DataExport { format: 'lubi-data'; version: 1; exportedAt: string; taskStore: TaskStore; records: Rec[]; }
/** No paths from imported JSON are used for writes. Unknown metadata is retained in the original JSON. */
export function parseRestore(text: string): DataExport {
  if (text.length > 25 * 1024 * 1024) throw new Error('导出超过 25MB，请拆分后人工恢复');
  const d = JSON.parse(text) as DataExport;
  if (!d || d.format !== 'lubi-data' || d.version !== 1 || d.taskStore?.version !== 14 || !Array.isArray(d.taskStore.tasks) || !Array.isArray(d.records)) throw new Error('仅支持 Lubi 完整导出 v1 / 任务 v14');
  if (d.records.length > 100000 || d.taskStore.tasks.length > 50000) throw new Error('条目过多');
  const ids = new Set<string>();
  for (const t of d.taskStore.tasks) {
    if (!t || typeof t.id !== 'string' || !t.id || ids.has(t.id) || typeof t.title !== 'string' || typeof t.category !== 'string' || !['todo','doing','done'].includes(t.status) || !['none','daily','weekly','monthly'].includes(t.repeat?.kind) || !Array.isArray(t.repeat.days) || !Array.isArray(t.doneDates) || !Array.isArray(t.skipDates) || !Number.isFinite(t.estimate) || t.estimate < 0) throw new Error('任务结构无效或 ID 重复');
    if ([t.date, t.startDate, t.endDate, ...t.doneDates, ...t.skipDates].some(x => x !== '' && (typeof x !== 'string' || !isValidDate(x)))) throw new Error('任务日期无效');
    ids.add(t.id);
  }
  if (d.taskStore.projects !== undefined && !Array.isArray(d.taskStore.projects)) throw new Error('项目结构无效');
  const pids = new Set<string>();
  for (const p of d.taskStore.projects || []) { if (!p || typeof p.id !== 'string' || !p.id || pids.has(p.id) || typeof p.title !== 'string') throw new Error('项目无效或重复'); pids.add(p.id); }
  for (const r of d.records) {
    if (!r || typeof r.date !== 'string' || !isValidDate(r.date) || typeof r.start !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(r.start) || !Number.isFinite(r.minutes) || r.minutes < 0 || r.minutes > 1440 || typeof r.title !== 'string' || typeof r.category !== 'string' || !r.category || /[\r\n]/.test(r.category) || !r.extra || typeof r.extra !== 'object' || Array.isArray(r.extra) || Object.entries(r.extra).some(([k,v]) => /[[\]\r\n:]/.test(k) || typeof v !== 'string') || (r.task !== undefined && (typeof r.task !== 'string' || /[[\]\r\n]/.test(r.task))) || (r.amount !== undefined && !Number.isFinite(r.amount))) throw new Error('记录结构无效');
    if (r.notes !== undefined && typeof r.notes !== 'string' || r.expenseType !== undefined && typeof r.expenseType !== 'string') throw new Error('记录文字无效');
    serializeRecord(r);
  }
  return d;
}
export function restoreWarnings(d: DataExport): string[] {
  const ids = new Set(d.taskStore.tasks.map(t => t.id));
  const orphan = d.records.filter(r => r.task && !ids.has(r.task)).length;
  const seen = new Set<string>(); let duplicates = 0;
  for (const r of d.records) { const key = r.date + serializeRecord(r); if (seen.has(key)) duplicates++; seen.add(key); }
  return [orphan ? `${orphan} 条记录关联已不存在的任务（保留）` : '', duplicates ? `${duplicates} 条疑似重复记录（不自动删除）` : ''].filter(Boolean);
}
