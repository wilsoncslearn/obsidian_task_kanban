// 一次性迁移脚本：在库根目录执行  node 插件源码/lubi/scripts/migrate-vault.mjs
// 1) 日记 HTML 卡片 → `## 记录` Markdown 列表（整份备份到 备份/迁移-<时间>/日记/）
// 2) 任务数据 v13 → v14（旧文件备份到 备份/迁移前-任务数据-v13-<时间>.json）
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { build } from "esbuild";

// Build the pure core logic (the same bundle the core tests use) right before running, so the script never runs stale code.
const pluginDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), "lubi-migrate-"));
const bundle = path.join(bundleDir, "lubi-core.mjs");
await build({
  absWorkingDir: pluginDir, entryPoints: ["test/helpers/entry.ts"], bundle: true, platform: "node", format: "esm",
  alias: { obsidian: "./test/helpers/stub-obsidian.js" }, outfile: bundle, logLevel: "warning",
});
const C = await import(pathToFileURL(bundle).href);
fs.rmSync(bundleDir, { recursive: true, force: true });

const root = process.cwd();
const journalDir = path.join(root, "日记");
const taskFile = path.join(root, "任务", "任务数据.json");
const stamp = C.stamp();
const dry = process.argv.includes("--dry");
let files = 0, records = 0;

if (fs.existsSync(journalDir)) {
  const backupDir = path.join(root, "备份", `迁移-${stamp}`, "日记");
  for (const f of fs.readdirSync(journalDir).filter((x) => /^\d{4}-\d{2}-\d{2}\.md$/.test(x)).sort()) {
    const p = path.join(journalDir, f);
    const text = fs.readFileSync(p, "utf8");
    const legacy = C.hasLegacyCards(text) || text.includes("<!-- daily-task-log:start -->") || text.includes("```dataviewjs");
    if (!legacy) continue;
    const date = f.slice(0, -3);
    const cards = C.parseLegacyCards(text, date);
    const existing = C.parseLines(text, date).map((r) => r.rec);
    const next = C.convertText(text, date, [...existing, ...cards]);
    console.log(`${f}: ${cards.length} 条卡片 → 新格式${dry ? "（干跑）" : ""}`);
    if (!dry) {
      fs.mkdirSync(backupDir, { recursive: true });
      fs.writeFileSync(path.join(backupDir, f), text);
      fs.writeFileSync(p, next);
    }
    files++; records += cards.length;
  }
  if (files) console.log(`日记：${files} 个文件、${records} 条记录${dry ? "" : `，备份在 ${path.relative(root, backupDir)}`}`);
  else console.log("日记：没有需要迁移的文件");
}

if (fs.existsSync(taskFile)) {
  const raw = fs.readFileSync(taskFile, "utf8");
  const data = JSON.parse(raw);
  if (data.version === 14) console.log("任务数据：已是 v14，跳过");
  else {
    const v14 = C.migrateLegacy(data);
    const backup = path.join(root, "备份", `迁移前-任务数据-v${data.version ?? 0}-${stamp}.json`);
    console.log(`任务数据：v${data.version} → v14，${v14.tasks.length} 个任务${dry ? "（干跑）" : `，备份在 ${path.relative(root, backup)}`}`);
    if (!dry) {
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.writeFileSync(backup, raw);
      fs.writeFileSync(taskFile, JSON.stringify(v14, null, 2));
    }
  }
}
console.log(dry ? "干跑完成，未写入任何文件。" : "迁移完成。");
