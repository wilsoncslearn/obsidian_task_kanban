// 记录 = 日记里 `## 记录` 下的一行 Markdown 列表项。
//
//   - 09:00–10:30 学习 · 三明治定理习题 [时长:: 1.5h] [任务:: 427a21a1] [备注:: 做了 12 题]
//   - 12:30 财务 · 午饭 [金额:: 35] [类别:: 餐饮]
//
// 人能读、能手写、Dataview 原生可查；解析器只认这一种形状，其他行原样保留。

import { fmtDuration, hmToMin, minToHM } from "./time";

export interface Rec {
  /** 所属日记日期 */
  date: string;
  /** HH:MM */
  start: string;
  /** 分钟；财务类可为 0 */
  minutes: number;
  /** 当次任务的预计用时快照（分钟），不参与实际时长统计；多条记录不可重复累加。 */
  estimatedMinutes?: number;
  category: string;
  title: string;
  task?: string;
  amount?: number;
  expenseType?: string;
  notes?: string;
  /** 其他自定义字段 */
  extra: Record<string, string>;
}

export interface ParsedLine {
  rec: Rec;
  /** 在日记文件中的行号（0-based） */
  line: number;
}

const LINE_RE = /^-\s+(\d{1,2}:\d{2})(?:\s*[–\-~到至]\s*(\d{1,2}:\d{2}))?\s+(\S+?)\s*[·:：]\s*(.*)$/;
const FIELD_RE = /\[([^[\]:]+)::\s*([^\]]*)\]/g;

const KNOWN: Record<string, keyof Rec> = {
  时长: "minutes",
  预计用时: "estimatedMinutes",
  任务: "task",
  金额: "amount",
  类别: "expenseType",
  备注: "notes",
};

export function parseDuration(text: string): number | null {
  const t = text.trim();
  let m = /^(\d+(?:\.\d+)?)\s*h(?:ours?)?$/i.exec(t) || /^(\d+(?:\.\d+)?)\s*小时$/.exec(t);
  if (m) return Math.round(Number(m[1]) * 60);
  m = /^(\d+(?:\.\d+)?)\s*(m|min|mins|分钟|分)$/i.exec(t);
  if (m) return Math.round(Number(m[1]));
  m = /^(\d+)\s*h\s*(\d+)\s*(m|min)?$/i.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = /^(\d+(?:\.\d+)?)$/.exec(t);
  if (m) return Math.round(Number(m[1]));
  return null;
}

export function fmtDurationField(min: number): string {
  if (min % 60 === 0) return `${min / 60}h`;
  if (min < 60) return `${min}min`;
  const h = min / 60;
  return `${Math.round(h * 100) / 100}h`;
}

export function parseRecordLine(line: string, date: string): Rec | null {
  const m = LINE_RE.exec(line.trim());
  if (!m) return null;
  const [, start, end, category, restRaw] = m;
  const extra: Record<string, string> = {};
  const fields: Record<string, string> = {};
  const title = restRaw
    .replace(FIELD_RE, (_all, k: string, v: string) => {
      fields[k.trim()] = v.trim();
      return "";
    })
    .replace(/\s{2,}/g, " ")
    .trim();

  let minutes = 0;
  if (fields["时长"] !== undefined) minutes = parseDuration(fields["时长"]) ?? 0;
  else if (end) {
    const diff = hmToMin(end) - hmToMin(start);
    minutes = diff >= 0 ? diff : diff + 1440;
  }

  const rec: Rec = { date, start: minToHM(hmToMin(start)), minutes, category, title, extra };
  for (const [k, v] of Object.entries(fields)) {
    const key = KNOWN[k];
    if (key === "estimatedMinutes") {
      const estimate = normalizeEstimatedMinutes(parseDuration(v));
      if (estimate !== undefined) rec.estimatedMinutes = estimate;
      else extra[k] = v; // 无效手写字段仍原样保留，但不用于对比。
    } else if (key === "task") rec.task = v || undefined;
    else if (key === "amount") rec.amount = v === "" ? undefined : Number(v.replace(/[^\d.-]/g, ""));
    else if (key === "expenseType") rec.expenseType = v || undefined;
    else if (key === "notes") rec.notes = unescapeField(v) || undefined;
    else if (key === "minutes") {
      /* handled */
    } else extra[k] = v;
  }
  return rec;
}

function escapeField(v: string): string {
  return v.replace(/\r?\n/g, " ").replace(/\]/g, "］").replace(/\[/g, "［").trim();
}
function unescapeField(v: string): string {
  return v.replace(/］/g, "]").replace(/［/g, "[");
}

export function serializeRecord(r: Rec): string {
  const parts: string[] = [];
  const startMin = hmToMin(r.start);
  const time = r.minutes > 0 ? `${minToHM(startMin)}–${minToHM(startMin + r.minutes)}` : minToHM(startMin);
  parts.push(`- ${time} ${r.category} · ${escapeField(r.title || "未命名")}`);
  if (r.minutes > 0) parts.push(`[时长:: ${fmtDurationField(r.minutes)}]`);
  const estimate = normalizeEstimatedMinutes(r.estimatedMinutes);
  if (estimate !== undefined) parts.push(`[预计用时:: ${fmtDurationField(estimate)}]`);
  if (r.amount !== undefined && !isNaN(r.amount)) parts.push(`[金额:: ${r.amount}]`);
  if (r.expenseType) parts.push(`[类别:: ${escapeField(r.expenseType)}]`);
  if (r.task) parts.push(`[任务:: ${r.task}]`);
  for (const [k, v] of Object.entries(r.extra || {})) if (v && (k !== "预计用时" || estimate === undefined)) parts.push(`[${k}:: ${escapeField(v)}]`);
  if (r.notes) parts.push(`[备注:: ${escapeField(r.notes)}]`);
  return parts.join(" ");
}

/**
 * 「待确认」：按计划 / 预计时长自动生成、还没被人核对过的记录。
 * 写成 `[待确认:: 按计划]`，人能读、Dataview 能查；编辑保存、拖动调整或点「确认」后去掉。
 */
export const PENDING_KEY = "待确认";

export function isPending(r: Rec): boolean {
  return !!r.extra?.[PENDING_KEY];
}

/** 去掉「待确认」标记后的副本 */
export function confirmed(r: Rec): Rec {
  const extra = { ...(r.extra || {}) };
  delete extra[PENDING_KEY];
  return { ...r, extra };
}

/** 只接受有效的正分钟数；任务未填预计时，不把默认记录时长当成预计。 */
export function normalizeEstimatedMinutes(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  const minutes = Math.round(value);
  return minutes > 0 ? minutes : undefined;
}

/** 每条记录的对比，只使用历史快照；待确认的记录不冒充已核实的实际用时。 */
export function formatEstimateComparison(r: Rec): string {
  const estimate = normalizeEstimatedMinutes(r.estimatedMinutes);
  if (estimate === undefined || !Number.isFinite(r.minutes) || r.minutes < 0) return "";
  const planned = `预计 ${fmtDuration(estimate)}`;
  if (isPending(r) && r.extra[PENDING_KEY] !== "实际开始未核对") return `${planned} · 记录 ${fmtDuration(r.minutes)}（待确认） · 核对后再比较`;
  const delta = r.minutes - estimate;
  const difference = delta === 0 ? "与预计一致" : `${delta > 0 ? "超出" : "少于"} ${fmtDuration(Math.abs(delta))}`;
  return `${planned} · 实际 ${fmtDuration(r.minutes)} · ${difference}${isPending(r) ? " · 实际开始待核对" : ""}`;
}

export function endMin(r: Rec): number {
  return hmToMin(r.start) + r.minutes;
}

export function sortRecs<T extends { rec: Rec }>(items: T[]): T[] {
  return items.slice().sort((a, b) => hmToMin(a.rec.start) - hmToMin(b.rec.start));
}

/** 把一条可能跨过午夜的记录拆成今日/明日两段 */
export function splitAtMidnight(r: Rec): { today: Rec; tomorrow: Rec | null } {
  const s = hmToMin(r.start);
  if (s + r.minutes <= 1440) return { today: r, tomorrow: null };
  const todayPart: Rec = { ...r, minutes: 1440 - s };
  const tomorrowPart: Rec = { ...r, start: "00:00", minutes: s + r.minutes - 1440 };
  return { today: todayPart, tomorrow: tomorrowPart };
}

// ---------- 旧版 HTML 卡片解析（仅用于迁移） ----------

// 卡片永远是单行；先剔除代码块，避免脚本源码里的同名字符串被误认为卡片
const CARD_RE = /<div class="journal-card">([^\n]*?)<div class="journal-right">[ \t]*(\d{1,2}:\d{2})[ \t]*<\/div>[ \t]*<\/div>/g;

export function stripCodeBlocks(text: string): string {
  return text.replace(/```[\s\S]*?```/g, "");
}

export function parseLegacyCards(text: string, date: string): Rec[] {
  const out: Rec[] = [];
  for (const m of stripCodeBlocks(text).matchAll(CARD_RE)) {
    const body = m[1];
    const time = m[2];
    const t = /class="journal-title">([\s\S]*?)<span class="journal-hashtag">#([^<]+)<\/span>/.exec(body);
    const rawTitle = (t?.[1] || "").replace(/<[^>]+>/g, "").trim();
    const category = (t?.[2] || "日常").trim();
    const title = (rawTitle.replace(/^[\p{Extended_Pictographic}\uFE0F\s]+/u, "").trim() || "未命名").slice(0, 200);
    const fields: Record<string, string> = {};
    for (const f of body.matchAll(/\[([^[\]:]+)::\s*([^\]]*)\]/g)) fields[f[1].trim()] = f[2].trim();
    const notesM = /class="journal-notes">([\s\S]*?)<\/div>/.exec(body);
    const rec: Rec = {
      date,
      start: minToHM(hmToMin(time)),
      minutes: fields["时长"] ? parseDuration(fields["时长"]) ?? 0 : 0,
      category,
      title,
      extra: {},
    };
    if (fields["任务"]) rec.task = fields["任务"];
    if (fields["金额"]) rec.amount = Number(fields["金额"].replace(/[^\d.-]/g, ""));
    if (fields["类别"]) rec.expenseType = fields["类别"];
    if (notesM) rec.notes = notesM[1].replace(/<[^>]+>/g, "").trim().slice(0, 1000) || undefined;
    out.push(rec);
  }
  return out;
}

export function hasLegacyCards(text: string): boolean {
  return CARD_RE.test(stripCodeBlocks(text)) ? ((CARD_RE.lastIndex = 0), true) : ((CARD_RE.lastIndex = 0), false);
}
