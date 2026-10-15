// Actual time belongs to journal records, not to the v14 task model.
import type LubiPlugin from '../main';
import { Task } from '../core/tasks';
import { ParsedLine, PENDING_KEY, Rec, parseRecordLine, serializeRecord, splitAtMidnight } from '../core/records';
import { hmToMin, minToHM, nowHM, todayStr, shiftDate, isValidDate } from '../core/time';

export async function taskActualRows(plugin: LubiPlugin, id: string, date: string): Promise<{ rows: ParsedLine[]; split: boolean }> {
  const rows = (await plugin.journal.read(date)).filter(row => row.rec.task === id && row.rec.minutes > 0);
  const reachesMidnight = rows.some(row => hmToMin(row.rec.start) + row.rec.minutes >= 1440);
  const split = reachesMidnight && (await plugin.journal.read(shiftDate(date, 1))).some(row => row.rec.task === id && row.rec.start === '00:00' && row.rec.minutes > 0);
  return { rows, split };
}

/** Save one actual record and its task; failed task writes restore the journal instead of leaving an orphan. */
export async function saveTaskActual(plugin: LubiPlugin, draft: Task, date: string, minutes: number, actualStart: string, expected: Rec | null, forecast: number | undefined, options: { complete?: boolean; completionDate?: string; independent?: boolean } = {}): Promise<{ task: Task; rec: Rec }> {
  if (!isValidDate(date) || !Number.isFinite(minutes) || minutes <= 0 || minutes > 1440) throw new Error('实际日期或用时无效；用时须为 1–1440 分钟');
  const beforeTask = plugin.tasks.byId(draft.id);
  const beforeTaskText = beforeTask ? JSON.stringify(beforeTask) : null;
  const current = await taskActualRows(plugin, draft.id, date);
  if (current.split || current.rows.length > 1) throw new Error('已有多段实际记录，请在时间轴分别编辑');
  const row = current.rows[0];
  if ((expected && (!row || serializeRecord(row.rec) !== serializeRecord(expected))) || (!expected && row)) throw new Error('实际记录已变化，请重新打开任务核对');
  let start = actualStart;
  if (start && (!/^\d{2}:\d{2}$/.test(start) || hmToMin(start) < 0 || hmToMin(start) >= 1440 || Number(start.slice(3)) > 59)) throw new Error('实际开始时间无效');
  if (!start) {
    const anchor = draft.start || (date === todayStr() ? minToHM(Math.max(0, hmToMin(nowHM()) - minutes)) : plugin.lastEndOf(date) || '09:00');
    start = minToHM(Math.max(0, Math.min(hmToMin(anchor), 1440 - minutes)));
  }
  const extra = { ...(row?.rec.extra || {}) };
  if (actualStart) delete extra[PENDING_KEY]; else extra[PENDING_KEY] = '实际开始未核对';
  let rec: Rec = row ? { ...row.rec, start, minutes, extra } : {
    date, start, minutes, title: draft.title.trim(), category: draft.category, task: draft.id,
    estimatedMinutes: forecast, notes: draft.notes || undefined, extra,
  };
  const written = parseRecordLine(serializeRecord(rec), date);
  if (!written) throw new Error("记录格式无效，请检查分类名称和标题");
  rec = written;
  const task: Task = { ...draft, repeat: { ...draft.repeat, days: [...draft.repeat.days] }, doneDates: [...draft.doneDates], skipDates: [...draft.skipDates], doneLogs: { ...draft.doneLogs, [date]: { date, start, title: rec.title, category: rec.category } } };
  if (options.independent) {
    if (beforeTask) throw new Error("独立用时不能覆盖已有任务");
    // Preserve the existing record-origin association, never add a planned to-do.
    task.origin = "record"; task.status = "done"; task.doneAt = new Date().toISOString();
    task.date = date; task.start = rec.start; task.estimate = 0;
    task.repeat = { kind: "none", days: [] }; task.doneDates = []; task.skipDates = [];
  } else if (options.complete) {
    const occurrenceDate = options.completionDate || date;
    if (!isValidDate(occurrenceDate)) throw new Error('任务发生日期无效');
    if (task.repeat.kind === 'none') { task.doneAt = task.status === 'done' && task.doneAt ? task.doneAt : new Date().toISOString(); task.status = 'done'; }
    else { task.doneDates = [...new Set([...task.doneDates, occurrenceDate])]; task.skipDates = task.skipDates.filter(day => day !== occurrenceDate); }
  }
  const split = splitAtMidnight(rec);
  const pieces = [split.today, ...(split.tomorrow ? [{ ...split.tomorrow, date: shiftDate(date, 1) }] : [])];
  const beforeCounts = new Map<string, number>();
  for (const piece of pieces) {
    const normalized = parseRecordLine(serializeRecord(piece), piece.date)!;
    const key = serializeRecord(normalized);
    beforeCounts.set(piece.date, (await plugin.journal.read(piece.date)).filter(item => serializeRecord(item.rec) === key).length);
  }
  try {
    if (row) await plugin.journal.update(date, row.line, rec); else await plugin.journal.add(rec);
    const latestTask = plugin.tasks.byId(draft.id);
    if (beforeTaskText !== (latestTask ? JSON.stringify(latestTask) : null)) throw new Error("任务在保存期间发生变化，实际记录未强行提交");
    const saved = await plugin.tasks.upsert(task, !!options.complete);
    return { task: saved, rec };
  } catch (error) {
    const failures: string[] = [];
    for (const piece of [...pieces].reverse()) {
      try {
        const normalized = parseRecordLine(serializeRecord(piece), piece.date)!;
        const key = serializeRecord(normalized);
        const latest = (await plugin.journal.read(piece.date)).filter(item => serializeRecord(item.rec) === key);
        if (row && piece.date === date) {
          if (serializeRecord(row.rec) !== key) {
            if (!latest.length) {
              const originalPresent = (await plugin.journal.read(date)).some(item => serializeRecord(item.rec) === serializeRecord(row.rec));
              if (originalPresent) continue;
              throw new Error('记录已被其他操作修改，未强行回滚');
            }
            await plugin.journal.update(date, latest.at(-1)!.line, row.rec);
          }
        } else if (latest.length > (beforeCounts.get(piece.date) || 0)) {
          await plugin.journal.remove(piece.date, latest.at(-1)!.line);
        }
      } catch (rollback) { failures.push((rollback as Error).message); }
    }
    try { await plugin.tasks.load(true); } catch (reload) { failures.push((reload as Error).message); }
    throw new Error((error as Error).message + (failures.length ? '；恢复未完成：' + failures.join('；') : '；实际记录已恢复，请核对任务状态'));
  }
}
