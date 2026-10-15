// AI exchange format for new planned tasks; deliberately not a backup/settings importer.
import { blankTask, Task, RepeatKind } from "./tasks";
import { isValidDate, todayStr } from "./time";

export const IMPORT_TASK_LIMIT = 200;
const FIELDS = ["project", "title", "category", "date", "start", "estimate", "notes", "location", "repeat", "startDate", "endDate", "subtasks"];
function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} 必须是对象`);
  return value as Record<string, unknown>;
}
function only(obj: Record<string, unknown>, fields: string[], path: string): void {
  if (Object.keys(obj).some(key => !fields.includes(key))) throw new Error(`${path} 包含不支持的字段，请按系统提示词生成`);
}
function text(value: unknown, path: string, fallback = "", limit = 20000): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.length > limit) throw new Error(`${path} 必须是长度不超过 ${limit} 的文字`);
  return value.trim();
}
function date(value: unknown, path: string, fallback = ""): string {
  const result = text(value, path, fallback, 10);
  if (result && !isValidDate(result)) throw new Error(`${path} 必须是有效的 YYYY-MM-DD 日期或空字符串`);
  return result;
}
export function parseTaskImport(input: string, categories: string[]): Task[] {
  if (input.length > 1000000) throw new Error("JSON 太长，请分批导入");
  let source = input.trim().replace(/^\uFEFF/, "");
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(source);
  if (fence) source = fence[1];
  let raw: unknown;
  try { raw = JSON.parse(source); } catch { throw new Error("JSON 格式错误，请粘贴完整 JSON 对象，不要附带解释文字"); }
  const root = object(raw, "JSON"); only(root, ["tasks"], "JSON");
  if (!Array.isArray(root.tasks) || !root.tasks.length) throw new Error("tasks 必须是至少包含一个任务的数组");
  const names = categories.filter(Boolean);
  if (!names.length) throw new Error("请先在设置中添加时间分类");
  const tasks: Task[] = [], order = Date.now();
  const visit = (value: unknown, path: string, depth: number, parent?: Task): void => {
    if (depth > 4) throw new Error("子任务最多支持 4 层");
    if (tasks.length >= IMPORT_TASK_LIMIT) throw new Error(`一次最多导入 ${IMPORT_TASK_LIMIT} 个任务（包含子任务）`);
    const obj = object(value, path); only(obj, FIELDS, path);
    const title = text(obj.title, `${path}.title`, "", 1000);
    if (!title) throw new Error(`${path}.title 不能为空`);
    const category = text(obj.category, `${path}.category`, parent?.category || names[0], 200);
    if (!names.includes(category)) throw new Error(`${path}.category 必须使用设置中已有的时间分类`);
    const day = date(obj.date, `${path}.date`, parent?.date || "");
    const start = text(obj.start, `${path}.start`, "", 5);
    if (start && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(start)) throw new Error(`${path}.start 必须是 00:00—23:59 的 HH:mm 或空字符串`);
    const estimate = obj.estimate === undefined ? 0 : obj.estimate;
    if (typeof estimate !== "number" || !Number.isSafeInteger(estimate) || estimate < 0 || estimate > 1440) throw new Error(`${path}.estimate 必须是 0—1440 的整数分钟，不要写 h/min`);
    let repeat: Task["repeat"] = { kind: "none", days: [] };
    if (obj.repeat !== undefined) {
      const r = object(obj.repeat, `${path}.repeat`); only(r, ["kind", "days"], `${path}.repeat`);
      if (!["none", "daily", "weekly", "monthly"].includes(String(r.kind)) || typeof r.kind !== "string") throw new Error(`${path}.repeat.kind 无效`);
      const kind = r.kind as RepeatKind, days = r.days === undefined ? [] : r.days;
      if (!Array.isArray(days) || days.some(n => typeof n !== "number" || !Number.isInteger(n)) || new Set(days).size !== days.length) throw new Error(`${path}.repeat.days 必须是不重复的整数数组`);
      if ((kind === "none" || kind === "daily") ? days.length !== 0 : !days.length || days.some(n => n < (kind === "weekly" ? 0 : 1) || n > (kind === "weekly" ? 6 : 31))) throw new Error(`${path}.repeat.days 范围不正确：每周 0—6，每月 1—31，其他类型为空数组`);
      repeat = { kind, days };
    }
    if (start && !day && repeat.kind === "none") throw new Error(`${path} 有开始时间时必须填写安排日期`);
    const from = date(obj.startDate, `${path}.startDate`), to = date(obj.endDate, `${path}.endDate`);
    if (from && to && from > to) throw new Error(`${path} 起止跨度日期不能倒置`);
    if (repeat.kind === "none" && (!!from !== !!to)) throw new Error(`${path} 普通任务的 startDate 和 endDate 必须一起填写`);
    if (repeat.kind === "none" && day && from && to && (day < from || day > to)) throw new Error(`${path}.date 必须位于起止跨度之内`);
    const task = blankTask({ title, category, date: day, start, estimate, location: text(obj.location, `${path}.location`, "", 200), notes: text(obj.notes, `${path}.notes`), repeat, startDate: from, endDate: to, parent: parent?.id || null, order: order + tasks.length });
    const project = text(obj.project, `${path}.project`, parent?.project || "", 200);if (project) task.project = project;
    tasks.push(task);
    if (obj.subtasks !== undefined) {
      if (!Array.isArray(obj.subtasks)) throw new Error(`${path}.subtasks 必须是数组`);
      obj.subtasks.forEach((child, i) => visit(child, `${path}.subtasks[${i}]`, depth + 1, task));
    }
  };
  root.tasks.forEach((task, i) => visit(task, `tasks[${i}]`, 1));
  return tasks;
}

export function taskImportPrompt(categories: string[], referenceDate = todayStr()): string {
  const example = { tasks: [{ title: "复习一个章节", category: categories[0] || "学习", date: referenceDate, start: "09:00", estimate: 60, location: "图书馆", notes: "复习并整理错题", repeat: { kind: "none", days: [] } }] };
  return `你是我的任务规划助手。我会与你讨论目标、时间安排和任务拆分；讨论时可以提问，只有当我说“生成导入 JSON”时，才输出最终数据。

参考日期：${referenceDate}。相对日期以此为准；如果我另给日期，以我提供的日期为准。
现有时间分类（只能从中选择，不新增分类）：${JSON.stringify(categories)}。

最终只输出一个合法 JSON 对象，不输出解释或 Markdown 代码块。根对象只能包含 tasks 数组。
任务只允许字段：title、category、project、date、start、estimate、notes、location、repeat、startDate、endDate。
- title：非空任务名，最多 1000 字符；category：上述分类之一。
- date：YYYY-MM-DD 或空字符串（未安排）；start：HH:mm 或空字符串，00:00—23:59。普通任务有 start 时必须有 date。
- estimate：预计用时的整数分钟，0—1440；不能写“1h”或“60min”。notes：文字，可省略。
- location：可选地点，文字，最多 200 字符；未明确提及地点时省略或写空字符串，不猜测、不从其他任务继承。
- repeat：可省略，默认 {"kind":"none","days":[]}。kind 仅 none/daily/weekly/monthly。none、daily 的 days=[]；weekly 的 days 为 0—6（0=周日，1=周一），monthly 的 days 为 1—31，需非空且不重复。
- 普通跨日任务 startDate/endDate 必须一起填写且起始不晚于结束；date 如填写须在跨度内。重复任务可用这两项限制生效日期。
- project：项目名称，可省略或写空字符串表示独立任务。项目只负责归属，不是待办；同项目任务写为 tasks 数组中的独立项，不生成父任务或 subtasks。不要凭空安排日期和时间。
- 一批总共不超过 ${IMPORT_TASK_LIMIT} 个任务，全部平铺在 tasks 数组。可有不同项目，也可有独立任务。
- 这只用于新增待做的规划任务；不要输出 id、parent、status、实际用时、历史记录、API Key、配置或 version。

格式示例（内容和日期只是示例，请按我们的讨论生成）：
${JSON.stringify(example, null, 2)}`;
}
