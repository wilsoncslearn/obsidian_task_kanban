// Background state is a manual annotation, never a journal record or an Agent controller.
import type { Task } from "./tasks";
import { isValidDate } from "./time";

export type Executor = "self" | "background";
export type BackgroundPhase = "ready" | "running" | "review" | "accepted";
export interface BackgroundRun {
  date: string;
  phase: BackgroundPhase;
  /** Accumulated wall-clock annotation, not personal effort or exact machine telemetry. */
  runtimeMs: number;
  startedAt?: string;
  stoppedAt?: string;
}
export interface BackgroundEntry { task: Task; date: string; run: BackgroundRun; }

export function executorOf(task: Pick<Task, "executor">): Executor {
  return task.executor === "background" ? "background" : "self";
}

export function backgroundKey(task: Pick<Task, "repeat">, date: string): string {
  return task.repeat.kind === "none" ? "once" : date;
}

export function backgroundRun(task: Task, date: string): BackgroundRun | undefined {
  const run = task.backgroundRuns?.[backgroundKey(task, date)];
  if (!run || typeof run !== "object" || !["ready", "running", "review", "accepted"].includes(run.phase) || !isValidDate(run.date)) return undefined;
  return run;
}

export function backgroundRuntimeMs(run: BackgroundRun | undefined, now = Date.now()): number {
  if (!run) return 0;
  const stored = Number.isFinite(run.runtimeMs) && run.runtimeMs >= 0 ? run.runtimeMs : 0;
  const start = run.startedAt ? Date.parse(run.startedAt) : NaN;
  return stored + (run.phase === "running" && Number.isFinite(start) ? Math.max(0, now - start) : 0);
}

/** Pure, idempotent state transition; no inferred schedule, estimate, category or actual record. */
export function withBackgroundPhase(task: Task, date: string, phase: BackgroundPhase, now = Date.now()): Task {
  if (executorOf(task) !== "background") throw new Error("请先将执行方式设为 Agent 后台");
  if (!["ready", "running", "review", "accepted"].includes(phase)) throw new Error("后台状态无效");
  if (!isValidDate(date)) throw new Error("后台任务发生日期无效");
  if (!Number.isFinite(now)) throw new Error("后台状态时间无效");
  const key = backgroundKey(task, date), previous = backgroundRun(task, date);
  if (previous?.phase === phase) return task;
  const raw = task.backgroundRuns?.[key];
  if (raw && !previous) throw new Error("后台标注格式异常，请核对后再修改");
  const runtimeMs = backgroundRuntimeMs(previous, now);
  const run: BackgroundRun = {
    ...previous,
    date: previous?.date || date,
    phase,
    runtimeMs,
    startedAt: phase === "running" ? new Date(now).toISOString() : undefined,
    stoppedAt: phase === "running" ? undefined : previous?.phase === "running" || phase === "review" ? new Date(now).toISOString() : previous?.stoppedAt,
  };
  return { ...task, backgroundRuns: { ...task.backgroundRuns, [key]: run } };
}

/** Ordinary plan edits preserve the latest runtime metadata; only state actions change it. */
export function prepareExecutionSave(draft: Task, previous?: Task, now = Date.now()): Task {
  let next: Task = { ...draft, ...(previous ? { backgroundRuns: previous.backgroundRuns } : {}) };
  if (executorOf(next) === "self") {
    if (previous && executorOf(previous) === "background") {
      for (const [key, run] of Object.entries(previous.backgroundRuns || {})) {
        if (!run || run.phase !== "running" || !isValidDate(run.date)) continue;
        next = { ...next, backgroundRuns: { ...next.backgroundRuns, [key]: {
          ...run, phase: "ready", runtimeMs: backgroundRuntimeMs(run, now), startedAt: undefined, stoppedAt: new Date(now).toISOString(),
        } } };
      }
    }
    return next;
  }
  if (next.repeat.kind === "none" && next.status === "done" && previous?.status !== "done") {
    next = withBackgroundPhase(next, backgroundRun(next, next.date)?.date || next.date || localDate(now), "accepted", now);
  } else if (next.repeat.kind === "none" && previous?.status === "done" && next.status !== "done" && backgroundRun(next, next.date)?.phase === "accepted") {
    next = withBackgroundPhase(next, backgroundRun(next, next.date)!.date, "review", now);
  } else if (next.repeat.kind !== "none") {
    for (const date of next.doneDates.filter(date => !previous?.doneDates.includes(date))) next = withBackgroundPhase(next, date, "accepted", now);
  }
  // Changing the repeat rule must not leave an invisible wall-clock annotation running.
  if (previous && JSON.stringify(previous.repeat) !== JSON.stringify(next.repeat)) {
    for (const [key, run] of Object.entries(next.backgroundRuns || {})) {
      if (!run || run.phase !== "running") continue;
      next = { ...next, backgroundRuns: { ...next.backgroundRuns, [key]: {
        ...run, phase: "ready", runtimeMs: backgroundRuntimeMs(run, now), startedAt: undefined, stoppedAt: new Date(now).toISOString(),
      } } };
    }
  }
  return next;
}

function localDate(now: number): string {
  const value = new Date(now);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

/** Read-only display date for an unscheduled completion; never fills a planned date. */
export function completedDate(task: Pick<Task, "status" | "doneAt" | "repeat">): string {
  if (task.repeat.kind !== "none" || task.status !== "done") return "";
  const time = Date.parse(task.doneAt);
  return Number.isFinite(time) ? localDate(time) : "";
}

export function backgroundEntries(tasks: readonly Task[], phase: "running" | "review"): BackgroundEntry[] {
  const out: BackgroundEntry[] = [];
  for (const task of tasks) {
    if (executorOf(task) !== "background") continue;
    for (const [key, run] of Object.entries(task.backgroundRuns || {})) {
      if (!run || run.phase !== phase || !isValidDate(run.date)) continue;
      if (task.repeat.kind === "none" ? key !== "once" || task.status === "done" : key !== run.date || task.doneDates.includes(run.date)) continue;
      out.push({ task, date: run.date, run });
    }
  }
  return out.sort((a, b) => (a.run.stoppedAt || a.run.startedAt || "").localeCompare(b.run.stoppedAt || b.run.startedAt || "") || a.task.order - b.task.order);
}
