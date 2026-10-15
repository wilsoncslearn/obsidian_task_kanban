// 旧版日记（HTML 卡片 + 任务执行记录表）→ 新版 `## 记录` Markdown 列表。
// 每个文件转换前先整份备份到 备份/迁移-<时间戳>/日记/。

import { App, TFile, normalizePath } from "obsidian";
import { LubiSettings } from "../settings";
import { hasLegacyCards, parseLegacyCards } from "../core/records";
import { writeSection, parseLines } from "./journal";
import { stamp } from "../core/time";

export interface MigrationReport {
  files: number;
  records: number;
  backupFolder: string;
  skipped: string[];
}

export async function detectLegacyJournals(app: App, settings: LubiSettings): Promise<TFile[]> {
  const out: TFile[] = [];
  const folder = normalizePath(settings.journalFolder);
  for (const f of app.vault.getMarkdownFiles()) {
    if (!f.path.startsWith(folder + "/")) continue;
    const text = await app.vault.cachedRead(f);
    if (hasLegacyCards(text) || text.includes("<!-- daily-task-log:start -->") || text.includes("```dataviewjs")) out.push(f);
  }
  return out;
}

export async function migrateJournals(app: App, settings: LubiSettings): Promise<MigrationReport> {
  const files = await detectLegacyJournals(app, settings);
  const backupFolder = normalizePath(`${settings.backupFolder}/迁移-${stamp()}/日记`);
  const report: MigrationReport = { files: 0, records: 0, backupFolder, skipped: [] };
  if (!files.length) return report;
  await mkdirp(app, backupFolder);
  for (const f of files) {
    const text = await app.vault.read(f);
    await app.vault.adapter.write(`${backupFolder}/${f.name}`, text);
    const date = f.basename;
    const legacy = parseLegacyCards(text, date);
    const existing = parseLines(text, date).map((r) => r.rec);
    const next = convertText(text, date, [...existing, ...legacy]);
    if (next === text) {
      report.skipped.push(f.path);
      continue;
    }
    await app.vault.modify(f, next);
    report.files++;
    report.records += legacy.length;
  }
  return report;
}

/** 纯函数：去掉旧卡片、任务日志块、内嵌 dataviewjs，写入新记录节 */
export function convertText(text: string, date: string, recs: import("../core/records").Rec[]): string {
  let t = text.replace(/\r\n/g, "\n");
  // 1. 删除 HTML 卡片行
  // 顺序很重要：先删代码块（里面有同名字符串），再删单行卡片
  t = t.replace(/```dataviewjs[\s\S]*?```/g, "");
  t = t.replace(/^[ \t]*<div class="journal-card">[^\n]*<div class="journal-right">[^\n]*<\/div>[ \t]*<\/div>[ \t]*$/gm, "");
  // 删除任务执行记录同步块（派生数据，备份里有）
  t = t.replace(/<!-- daily-task-log:start -->[\s\S]*?<!-- daily-task-log:end -->/g, "");
  // 旧模板 frontmatter 里的 cssclasses: dash-locked 会把整页锁死，去掉
  t = t.replace(/^cssclasses:\s*\[?\s*dash-locked\s*\]?\s*$/m, "");
  // 确保 frontmatter 含 date + H1
  if (!t.startsWith("---")) t = `---\ndate: ${date}\n---\n\n${t}`;
  t = t.replace(/^---\n([\s\S]*?)\n?---/, (_all, fm: string) => {
    const body = fm.split("\n").filter((l) => l.trim());
    if (!body.some((l) => /^date:/.test(l))) body.unshift(`date: ${date}`);
    return `---\n${body.join("\n")}\n---`;
  });
  if (!/^#\s/m.test(t)) t = t.replace(/^(---[\s\S]*?---\n)/, `$1\n# ${date}\n`);
  t = t.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
  return writeSection(t, recs);
}

async function mkdirp(app: App, folder: string): Promise<void> {
  const parts = folder.split("/");
  let cur = "";
  for (const p of parts) {
    cur = cur ? `${cur}/${p}` : p;
    if (!(await app.vault.adapter.exists(cur))) await app.vault.createFolder(cur);
  }
}
