// 任务模型 v14：一张扁平表，parent 表示层级。没有"规划/管理"双来源，没有"放行"。
// 安排到某天 = 填 date；重复任务用 repeat 规则投影到每天，完成情况记在 doneDates。

import { parseDate, shiftDate, uid, weekStart } from "./time";
import { BackgroundRun, Executor, completedDate } from "./execution";

export type TaskStatus = "todo" | "doing" | "done";
export type RepeatKind = "none" | "daily" | "weekly" | "monthly";

export interface Project { id: string; title: string; created: string; budgetMinutes?: number; }

export interface Task {
  budgetMinutes?: number;
  outcome?: import("./productivity").TaskOutcome;
  archived?: boolean;
  reschedules?: number;
  id: string;
  title: string;
  category: string;
  /** 可选地点；旧任务未填写时为空。 */
  location?: string;
  /** Optional v14 metadata; old tasks are self-executed without migration. */
  executor?: Executor;
  backgroundRuns?: Record<string, BackgroundRun>;
  parent: string | null;
  /** Optional project membership; legacy parent links remain readable until conversion. */
  project?: string;
  status: TaskStatus;
  blocked: boolean;
  /** 安排执行日 YYYY-MM-DD，空 = 未安排 */
  date: string;
  /** 安排开始时间 HH:MM，空 = 全天 */
  start: string;
  /** 预计本人投入分钟；后台标注用时单独保存。 */
  estimate: number;
  repeat: { kind: RepeatKind; days: number[] };
  /** 重复任务：已完成的日期 */
  doneDates: string[];
  /** 重复任务：主动跳过的日期（只影响当天，不改变重复规则） */
  skipDates: string[];
  /** 项目跨度（可选，用于甘特） */
  startDate: string;
  endDate: string;
  notes: string;
  order: number;
  doneAt: string;
  created: string;
  updated: string;
  /** 兼容旧版的关联记录标记；取消完成不再删除实际记录。 */
  doneLogs?: Record<string, DoneLog>;
  /** "record"：在每日页直接记下的已完成事项自动生成的任务；删掉那条记录时一起删除 */
  origin?: "record";
}

/** 用开始时间 + 标题 + 分类（+ 关联任务）定位一条记录；不含时长，跨夜拆分后仍能找到 */
export interface DoneLog {
  date: string;
  start: string;
  title: string;
  category: string;
}

export interface TaskStore {
  version: 14;
  tasks: Task[];
  projects?: Project[];
  projectContainers?: string[];
}

export function blankTask(partial: Partial<Task> = {}): Task {
  const now = new Date().toISOString();
  return {
    id: uid(),
    title: "",
    category: "",
    location: "",
    parent: null,
    status: "todo",
    blocked: false,
    date: "",
    start: "",
    estimate: 0,
    repeat: { kind: "none", days: [] },
    doneDates: [],
    skipDates: [],
    startDate: "",
    endDate: "",
    notes: "",
    order: Date.now(),
    doneAt: "",
    created: now,
    updated: now,
    ...partial,
  };
}


// ---------- helpers ----------

export function byOrder(a: Task, b: Task): number {
  return a.order - b.order || a.created.localeCompare(b.created);
}
export function byTime(a: Task, b: Task): number {
  if (a.start && b.start) return a.start.localeCompare(b.start) || byOrder(a, b);
  if (a.start) return -1;
  if (b.start) return 1;
  return byOrder(a, b);
}

export function occursOn(t: Task, date: string): boolean {
  if (t.skipDates?.includes(date)) return false;
  if (t.repeat.kind === "none") return t.date === date || (!t.date && completedDate(t) === date);
  if (t.startDate && date < t.startDate) return false;
  if (t.endDate && date > t.endDate) return false;
  if (t.created && date < t.created.slice(0, 10) && !t.startDate) return false;
  const d = parseDate(date);
  if (t.repeat.kind === "daily") return true;
  if (t.repeat.kind === "weekly") return t.repeat.days.includes((d.getDay() + 6) % 7 + 1);
  if (t.repeat.kind === "monthly") return t.repeat.days.includes(d.getDate());
  return false;
}

export function weekOf(date: string): string[] {
  const s = weekStart(date);
  return Array.from({ length: 7 }, (_, i) => shiftDate(s, i));
}

export function normalize(t: Partial<Task>): Task {
  const b = blankTask();
  return {
    ...b,
    ...t,
    repeat: { kind: t.repeat?.kind || "none", days: Array.isArray(t.repeat?.days) ? t.repeat.days : [] },
    doneDates: Array.isArray(t.doneDates) ? t.doneDates : [],
    skipDates: Array.isArray(t.skipDates) ? t.skipDates : [],
    order: typeof t.order === "number" ? t.order : b.order,
    estimate: typeof t.estimate === "number" ? t.estimate : 0,
    doneLogs: cleanDoneLogs(t.doneLogs),
  };
}

function cleanDoneLogs(v: unknown): Record<string, DoneLog> | undefined {
  if (!v || typeof v !== "object") return undefined;
  const out: Record<string, DoneLog> = {};
  for (const [k, x] of Object.entries(v as Record<string, Partial<DoneLog>>)) {
    if (x && typeof x.start === "string" && typeof x.title === "string") out[k] = { date: x.date || k, start: x.start, title: x.title, category: x.category || "" };
  }
  return Object.keys(out).length ? out : undefined;
}

// ---------- v13 → v14 ----------

interface LegacyNode {
  id: string;
  title?: string;
  categoryId?: string;
  taskId?: string;
  parentId?: string | null;
  status?: string;
  startDate?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  notes?: string;
  estimate?: number | null;
  retired?: boolean;
  completedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  sequenceOrder?: number | null;
  schedule?: {
    repeat?: string;
    weekdays?: number[];
    monthDays?: number[];
    startTime?: string;
    endTime?: string;
    anchor?: string;
  };
}
export interface LegacyStore {
  version?: number;
  categories?: { id: string; name: string }[];
  tasks?: LegacyNode[];
  subtasks?: LegacyNode[];
}

const STATUS_MAP: Record<string, TaskStatus> = { pending: "todo", doing: "doing", blocked: "todo", done: "done" };

export function migrateLegacy(old: LegacyStore): TaskStore {
  const cats = new Map((old.categories || []).map((c) => [c.id, c.name]));
  const roots = old.tasks || [];
  const rootCat = new Map(roots.map((t) => [t.id, cats.get(t.categoryId || "") || ""]));
  const out: Task[] = [];
  let order = 1;
  const convert = (n: LegacyNode, parent: string | null, category: string): Task => {
    const sched = n.schedule || {};
    const rk = sched.repeat as RepeatKind | undefined;
    const kind: RepeatKind = rk === "daily" || rk === "weekly" || rk === "monthly" ? rk : "none";
    const est = typeof n.estimate === "number" && n.estimate > 0 ? n.estimate : 0;
    const start = n.startTime || sched.startTime || "";
    let estimate = est;
    if (!estimate && start && (n.endTime || sched.endTime)) {
      const [sh, sm] = start.split(":").map(Number);
      const [eh, em] = (n.endTime || sched.endTime || "").split(":").map(Number);
      const diff = eh * 60 + em - (sh * 60 + sm);
      if (diff > 0) estimate = diff;
    }
    const t = blankTask({
      id: n.id,
      title: n.title || "未命名",
      category,
      parent,
      status: STATUS_MAP[n.status || "pending"] || "todo",
      blocked: n.status === "blocked",
      date: kind === "none" ? n.startDate || "" : "",
      start: kind === "none" ? (n.startDate ? start : "") : start,
      estimate,
      repeat: { kind, days: kind === "weekly" ? sched.weekdays || [] : kind === "monthly" ? sched.monthDays || [] : [] },
      startDate: kind !== "none" ? n.startDate || sched.anchor || "" : "",
      endDate: kind !== "none" ? n.endDate || "" : "",
      notes: n.notes || "",
      order: typeof n.sequenceOrder === "number" ? n.sequenceOrder : order++,
      doneAt: n.completedAt || "",
      created: n.createdAt || new Date().toISOString(),
      updated: n.updatedAt || new Date().toISOString(),
    });
    return t;
  };
  for (const r of roots) if (!r.retired) out.push(convert(r, null, rootCat.get(r.id) || ""));
  for (const s of old.subtasks || []) {
    if (s.retired) continue;
    const parent = s.parentId || s.taskId || null;
    out.push(convert(s, parent, rootCat.get(s.taskId || "") || ""));
  }
  return { version: 14, tasks: out };
}
