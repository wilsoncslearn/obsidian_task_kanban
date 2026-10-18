// Render benchmark on synthetic data: about three years of journals and 2,000 tasks in the in-memory Vault.
// No real Vault is read or written. Run with `npm run bench`; it fails when a step exceeds its limit.
// Times come from jsdom in Node, so they compare runs on the same machine; they are not real Obsidian frame times.
import Module, { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import * as O from '../helpers/mock-obsidian.js';
const load = Module._load; Module._load = function (id, ...args) { return id === 'obsidian' ? O : load.call(this, id, ...args); };
const Plugin = createRequire(import.meta.url)(process.env.LUBI_TEST_PLUGIN || '../.out/plugin.cjs').default;
const { blankTask, serializeRecord, shiftDate, todayStr, DEFAULT_CATEGORIES } = await import('../.out/core.mjs');

// Limits in milliseconds, about four times the times measured on the development machine on 2026-10-16
// (startup 85, planning 870, planning week 90, review 110, review year 205), so only real regressions fail.
const LIMITS = { startup: 400, planning: 3500, planningWeek: 400, review: 450, reviewYear: 800 };
const DAYS = 3 * 365, TASKS = 2000, RECORDS_PER_DAY = 8;
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };
const timed = async (fn) => { const start = performance.now(); await fn(); await settle(); return Math.round(performance.now() - start); };
const button = (root, text) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === text);

const app = new O.App();
const today = todayStr();
const categories = DEFAULT_CATEGORIES.filter((c) => c.kind !== 'money').map((c) => c.name);
for (let d = 0; d < DAYS; d++) {
  const date = shiftDate(today, -d);
  const lines = Array.from({ length: RECORDS_PER_DAY }, (_, i) => serializeRecord({
    date, start: `${String(7 + i * 2).padStart(2, '0')}:${i % 2 ? '30' : '00'}`, minutes: 30 + (i % 4) * 15,
    category: categories[(d + i) % categories.length], title: `合成记录 ${i % 12}`, extra: {},
  }));
  await app.vault.create(`日记/${date}.md`, `---\ndate: ${date}\n---\n\n# ${date}\n\n## 记录\n\n${lines.join('\n')}\n`);
}
const tasks = Array.from({ length: TASKS }, (_, i) => blankTask({
  id: `bench-${i}`, title: `合成任务 ${i}`, category: categories[i % categories.length],
  date: i % 10 === 0 ? '' : shiftDate(today, (i % 121) - 60), start: i % 3 ? '' : `${String(8 + (i % 10)).padStart(2, '0')}:00`,
  estimate: 15 + (i % 8) * 15, repeat: i % 50 === 0 ? { kind: 'weekly', days: [1, 3, 5] } : { kind: 'none', days: [] },
}));
await app.vault.create('任务/任务数据.json', JSON.stringify({ version: 14, tasks }));

const plugin = new Plugin(app, { id: 'lubi', version: '1.8.0' });
const results = {};
results.startup = await timed(async () => { await plugin.onload(); for (const fn of app.workspace._ready) await fn(); });
let view;
results.planning = await timed(async () => { view = await plugin.activateView('tasks', today); });
const weekButton = button(view.contentEl, '周');
results.planningWeek = weekButton ? await timed(async () => { weekButton.click(); }) : null;
let review;
results.review = await timed(async () => { review = await plugin.activateView('review', today); });
const yearButton = button(review.contentEl, '年');
results.reviewYear = yearButton ? await timed(async () => { yearButton.click(); }) : null;

let failed = false;
console.log(`synthetic data: ${DAYS} journal days × ${RECORDS_PER_DAY} records, ${TASKS} tasks`);
for (const [step, ms] of Object.entries(results)) {
  if (ms === null) { console.log(`SKIP ${step}: control not found`); continue; }
  const ok = ms <= LIMITS[step];
  failed ||= !ok;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${step.padEnd(12)} ${String(ms).padStart(6)} ms  (limit ${LIMITS[step]} ms)`);
}
plugin.onunload();
process.exit(failed ? 1 : 0);
