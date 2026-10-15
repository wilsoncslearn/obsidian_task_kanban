import * as O from "../helpers/mock-obsidian.js";
import { fixtureVault } from "../helpers/fixtures.mjs";
import Module from "module";
import { createRequire } from "module";
const origLoad = Module._load;
Module._load = function (req, ...a) { return req === "obsidian" ? O : origLoad.call(this, req, ...a); };
const require = createRequire(import.meta.url);
const LubiPlugin = require(process.env.LUBI_TEST_PLUGIN || "../.out/plugin.cjs").default;
let fails = 0;
const check = (cond, msg) => { if (!cond) { fails++; console.log("FAIL", msg); } else console.log("ok  ", msg); };
const tick = () => new Promise((r) => setTimeout(r, 30));

const checkInfoWithoutFooter = async (target, label, required) => {
  check(!!target?.isConnected, 'tooltip footer: fixture available for ' + label);
  if (!target?.isConnected) return;
  // Keyboard-focus tooltips render synchronously. Do not yield with a captured element:
  // a queued view refresh can detach it before focus or remove its tooltip before assertions.
  target.focus();
  const card = document.body.querySelector('.lubi-tip');
  check(!!card && required.every(text => card.textContent.includes(text)), 'tooltip footer: ' + label + ' retains its information');
  check(!!card && !card.querySelector('.lubi-task-tip-help') && !/拖动改时间|拉边缘改|点击或回车编辑|Shift 精确到分钟|点击记实际时间/.test(card.textContent), 'tooltip footer: ' + label + ' has no operation footer');
  target.blur();
};


// 在内存 Vault 装入合成夹具，不依赖真实仓库数据或私人备份。
const app = new O.App();
for (const [path, text] of Object.entries(fixtureVault)) app.vault.files.set(path, text);

const plugin = new LubiPlugin(app, { id: "lubi", version: "1.0.0" });
await plugin.onload();
for (const fn of app.workspace._ready) await fn();
await tick();
check(plugin.tasks.all.length === 18, `tasks loaded & migrated: ${plugin.tasks.all.length}`);
check(plugin.tasks.lastMigrationBackup?.startsWith("备份/迁移前-任务数据-v13"), "v13 backup written: " + plugin.tasks.lastMigrationBackup);
const v14 = JSON.parse(app.vault.files.get("任务/任务数据.json")); check(v14.version === 14, "task file rewritten as v14");
// 自动迁移应该弹出确认框
const confirm = O.openModals.find((m) => m.constructor.name === "ConfirmModal");
check(!!confirm, "legacy journal prompt shown");
if (confirm) { const ok = [...confirm.contentEl.querySelectorAll("button")].find((b) => b.textContent === "转换"); ok.click(); await tick(); await tick(); }
const j24 = app.vault.files.get("日记/2026-09-24.md");
check(j24.includes("## 记录") && !j24.includes("journal-card") && !j24.includes("daily-task-log"), "2026-09-24 migrated");
check([...app.vault.files.keys()].some((k) => k.startsWith("备份/迁移-") && k.endsWith("/日记/2026-09-13.md")), "journal backup written");
check(!(await import("../.out/core.mjs")).hasLegacyCards(app.vault.files.get("日记/2026-09-13.md")), "no legacy left in 09-13");
console.log("notices:", O.notices.slice(-3));

// 打开视图，渲染三页
const view = await plugin.activateView("today", "2026-09-24");
await tick();
const root = view.contentEl;
// Existing timeline-record editor is still tested directly; public creation is tested via TaskModal below.
root.querySelector('.lubi-block-actions [data-icon="pencil"]').click();await tick();const legacyModal=O.openModals.at(-1),LegacyTimeForm=legacyModal.constructor;legacyModal.close();
const {todayStr:realToday}=await import('../.out/core.mjs');
const openLegacyTime=(instance=plugin,host=app)=>{const modal=new LegacyTimeForm(host,instance,{date:instance.views()[0]?.activeDate()||realToday(),onSaved:()=>instance.refreshViews()});modal.open();return modal};
const fillActual=(modal,minutes,start)=>{for(const [key,value,type]of [['minutes',String(minutes),'input'],['start',start,'change']]){const input=modal.contentEl.querySelector('[data-actual='+key+']');input.value=value;input.dispatchEvent(new window.Event(type,{bubbles:true}))}};

const beforeSimplifiedRender = JSON.stringify([...app.vault.files]);
const initialHourLabels = [...root.querySelectorAll(".lubi-hour-label")];
check(initialHourLabels.length === 25 && initialHourLabels[0]?.textContent === "00:00" && initialHourLabels[24]?.textContent === "24:00", "ruler: labels every hour from 00:00 through 24:00");
check(initialHourLabels[0]?.classList.contains("is-day-start") && initialHourLabels[24]?.classList.contains("is-day-end"), "ruler: day boundary labels use dedicated alignment");
check(root.querySelector(".lubi-timeline")?.style.getPropertyValue("--lubi-day-start-gutter") === "32px" && root.querySelector(".lubi-tl-gutter")?.style.top === "" && initialHourLabels[0]?.style.top === "32px", "ruler: reserve a 32px plan header above 00:00");
check(root.querySelector(".lubi-tl-canvas")?.style.bottom === "16px" && root.querySelector(".lubi-tl-line.is-day-end")?.style.top === initialHourLabels[24]?.style.top, "ruler: 24:00 has its own rule and lower clearance without adding schedulable time");
const blocks = () => [...root.querySelectorAll(".lubi-block:not(.lubi-block-ghost)")];
check(blocks().length === 1, "today timeline shows 1 block");
await checkInfoWithoutFooter(blocks()[0], "daily record", ["分类："]);
check(root.querySelector(".lubi-donut") !== null, "donut rendered");
check(!root.querySelector(".lubi-today-side").classList.contains("lubi-card") && !root.querySelector(".lubi-today-side .lubi-card .lubi-card") && root.querySelector(".lubi-distribution.lubi-card"), "sidebar: distribution and plan use independent non-nested cards");
check(root.querySelector(".lubi-today-side").firstElementChild?.classList.contains("lubi-background-card") && root.querySelector(".lubi-personal-time")?.nextElementSibling?.classList.contains("lubi-distribution") && !root.querySelector(".lubi-distribution").matches("details") && root.querySelector(".lubi-distribution .lubi-donut"), "MONO sidebar: background and personal time precede the preserved distribution");
check([...root.querySelectorAll(".lubi-today-side .lubi-gap-card")].every(d => d.open), "gaps: visible by default");
check(!root.querySelector(".lubi-tl-hint, .lubi-tl-stats, .lubi-onboard"), "simplify: no repeated timeline statistics or large onboarding");
check(root.querySelectorAll(".mod-cta").length === 1, "simplify: daily page has one emphasized primary action");
check(!root.querySelector(".lubi-day-tasks") && [...root.querySelectorAll(".lubi-plan-task-list .lubi-task")].every(row => row.closest(".lubi-plan-task-details") && row.closest(".lubi-plan-task-details").open), "day plan rows are confined to an expanded dropdown, separate from inbox");
view.show("review", "2026-09-24"); await tick(); await tick();
check(root.querySelectorAll(".lubi-kpi").length >= 4, "review KPIs rendered");
check(root.querySelectorAll(".lubi-kpis.lubi-card").length === 1 && !root.querySelector(".lubi-review-signals"), "simplify: review statistics are consolidated without a duplicate signals strip");
check(root.querySelectorAll(".lubi-review-extras.lubi-card").length === 1 && !root.querySelector(".lubi-review-extras .lubi-card"), "simplify: review details and analysis share one secondary container");
check(!root.querySelector(".lubi-review-breakdown").open && !root.querySelector(".lubi-review-insights").open && !root.querySelector(".lubi-review-insights .lubi-card"), "simplify: review details and analysis are folded without nested cards");
const analysisFold = root.querySelector(".lubi-review-insights");
analysisFold.open = true;
check(analysisFold.textContent.includes("本期摘要") && analysisFold.textContent.includes("计划 vs 实际") && analysisFold.textContent.includes("未记录时段"), "simplify: expanded review keeps all existing analysis");
analysisFold.open = false;
check(root.querySelectorAll(".lubi-bar-col").length === 7, "review week has 7 bars");
view.review.period = "month"; view.show("review"); await tick(); await tick();
check(root.querySelectorAll(".lubi-bar-col").length === 30, "review month has 30 bars");
view.tasksState.period = "week"; view.show("tasks", "2026-09-24"); await tick();
check(root.querySelectorAll(".lubi-week-col").length === 7, "week schedule 7 columns");
check([...root.querySelectorAll('.lubi-week-date')].map(e=>e.textContent).join(',') === '9/21,9/22,9/23,9/24,9/25,9/26,9/27', 'week headers show month/day');
view.show('tasks', '2026-11-01'); await tick();
check([...root.querySelectorAll('.lubi-week-date')].map(e=>e.textContent).join(',') === '10/26,10/27,10/28,10/29,10/30,10/31,11/1', 'week headers retain actual months across a month boundary');
view.show('tasks', '2026-09-24'); await tick();

check(!root.querySelector(".lubi-task-lists.lubi-card") && root.querySelector(".lubi-task-lists .lubi-inbox-card.lubi-card") && root.querySelector(".lubi-attention-card")?.parentElement?.classList.contains("lubi-planning-main"), "MONO hierarchy: attention in main, independent background/time/inbox sidebar cards");
check(!root.querySelector(".lubi-selected-day-list .lubi-panel-head button") && root.querySelector(".lubi-inbox-card .lubi-inbox-add"), "MONO: no duplicate day-create button, distinct unplanned create retained");
check(root.querySelectorAll(".mod-cta").length === 1 && root.querySelector(".lubi-quick-add input"), "simplify: task page has one primary CTA and keeps quick input");
root.querySelector(".lubi-more-btn").click();
const aiButton = root.querySelector(".lubi-topbar-ai");
check(!!aiButton && aiButton.nextElementSibling === root.querySelector(".lubi-topbar-cta") && !aiButton.classList.contains("mod-cta"), "AI entry: secondary button immediately left of new task");
check(!O.menus.at(-1).items.some(i => i.title === "AI 创建任务") && !root.querySelector(".lubi-list-card").textContent.includes("AI 创建"), "AI entry: moved out of more menu without duplicate list entry");
aiButton.click(); await tick();
check(O.openModals.at(-1)?.constructor.name === "AiTaskModal" && O.openModals.at(-1).date === "2026-09-24", "simplify: moved AI entry opens the original modal for the selected date");
O.openModals.at(-1)?.close();
check(JSON.stringify([...app.vault.files]) === beforeSimplifiedRender, "simplify: viewing all pages, expanding analysis and opening AI do not rewrite data");

// A timed planned fixture: actual-record tasks are no longer a planning-list fixture.
await plugin.tasks.upsert((await import('../.out/core.mjs')).blankTask({id:'quiet-planning-row',title:'合成任务行悬停检查',date:'2026-09-24',start:'20:15',estimate:30,category:'学习'}));
await new Promise(resolve=>setTimeout(resolve,200));view.show('tasks','2026-09-24');await tick();
// 清单中已展示的任务内容不再重复提示；操作入口和读屏名称仍保留。
const quietRow = root.querySelector('.lubi-task[data-task-id="quiet-planning-row"]');
const quietTitle = quietRow.querySelector('.lubi-task-title');
const quietMeta = quietRow.querySelector('.lubi-task-meta');
const quietCheckbox = quietRow.querySelector('input[type=checkbox]');
for (const [name, target] of [['title', quietTitle], ['title text', quietTitle.querySelector('.lubi-task-title-text')], ['time/duration', quietMeta], ['checkbox', quietCheckbox]]) {
  check(!!target, 'list tooltip: fixture has ' + name);
  target.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 280));
  check(!document.body.querySelector('.lubi-tip'), 'list tooltip: ' + name + ' has no pointer hover card');
  target.focus(); await tick();
  check(!document.body.querySelector('.lubi-tip'), 'list tooltip: ' + name + ' has no focus hover card');
  target.blur();
}
check([quietTitle, quietCheckbox].every(el => !el.hasAttribute('aria-label') && !el.hasAttribute('title') && !el.hasAttribute('data-lubi-tip') && document.getElementById(el.getAttribute('aria-labelledby'))?.textContent), 'list tooltip: accessible edit/completion names remain without native or custom hover labels');
const startHint = quietRow.querySelector('.lubi-task-start');
startHint.focus(); await tick();
check(document.body.querySelector('.lubi-tip')?.textContent.includes('记录本人实际'), 'list tooltip: green start action keeps its operation hint');
startHint.blur();

const weekTicks = [...root.querySelectorAll(".lubi-week-hour")];
const weekColumns = [...root.querySelectorAll(".lubi-week-col")];
const bottomLines = [...root.querySelectorAll(".lubi-week-line.is-day-end")];
check(weekTicks[0]?.textContent === "00:00" && weekTicks.at(-1)?.textContent === "24:00", "week ruler: full-day planning shows 00:00 through 24:00");
check(bottomLines.length === 7 && bottomLines.every(line => line.style.top === weekColumns[0]?.style.height), "week ruler: 24:00 boundary aligns across all seven columns");
check(root.querySelectorAll(".lubi-wblock").length >= 1, `week blocks: ${root.querySelectorAll(".lubi-wblock").length}`);
await checkInfoWithoutFooter(root.querySelector(".lubi-wblock"), "weekly task", ["预计用时："]);
check(!root.querySelector(".lubi-tasks-projects, .lubi-project-toggle, .lubi-gantt, .lubi-project-peek"), "planning: independent project panel is removed even when projects exist");
check(!root.querySelector(".lubi-error"), "no render errors");

// 记一条：通过模态保存
view.show("today"); await tick();
openLegacyTime();
const rm = O.openModals.at(-1);
const q = (s) => rm.contentEl.querySelector(s);
q('input[type="text"]').value = "写测试"; q('input[type="text"]').dispatchEvent(new window.Event("input"));
q('input[type="time"]').value = "20:00"; q('input[type="time"]').dispatchEvent(new window.Event("change"));
q('input[type="number"]').value = "45"; q('input[type="number"]').dispatchEvent(new window.Event("input"));
[...rm.contentEl.querySelectorAll("button")].find((b) => b.textContent.includes("记下")).click();
await tick(); await tick();
check(app.vault.files.get("日记/2026-09-24.md").includes("- 20:00–20:45 学习 · 写测试 [时长:: 45min]"), "record saved via modal");
{
  const t = plugin.tasks.all.find((x) => x.title === "写测试");
  check(!!t && t.origin === "record" && t.status === "done" && t.date === "2026-09-24" && t.start === "20:00" && t.estimate === 45, "new daily record also creates a done task");
  check(app.vault.files.get("日记/2026-09-24.md").includes(`[任务:: ${t?.id}]`), "new daily record is linked to its done task");
}
await new Promise((r) => setTimeout(r, 250)); check(blocks().length === 2, "timeline now 2 blocks (after debounce)");
// 跨夜拆分
await plugin.journal.add({ date: "2026-09-24", start: "23:30", minutes: 90, category: "睡眠", title: "睡觉", extra: {} });
check(app.vault.files.get("日记/2026-09-24.md").includes("23:30–00:00 睡眠") && app.vault.files.get("日记/2026-09-25.md")?.includes("00:00–01:00 睡眠"), "midnight split across files");
// 24h 上限
let capErr = null; try { await plugin.journal.add({ date: "2026-09-24", start: "00:00", minutes: 1440, category: "日常", title: "x", extra: {} }); } catch (e) { capErr = e.message; }
check(capErr?.includes("24"), "24h cap enforced: " + capErr);
// Completion is a state fact, even when a legacy auto-log preference remains true.
plugin.settings.promptLogOnComplete = true;
view.tasksState.period = "week"; view.show("tasks", "2026-09-24"); await tick();
{
  const task = [...root.querySelectorAll(".lubi-task")].find(row => !row.classList.contains("is-done"));
  const before = app.vault.files.get("日记/2026-09-24.md"), dialogs = O.openModals.length;
  task.querySelector("input[type=checkbox]").click(); for (let i = 0; i < 5; i++) await tick();
  check(O.openModals.length === dialogs, "completion: no implicit record dialog");
  check(app.vault.files.get("日记/2026-09-24.md") === before, "completion: legacy preference does not fabricate a record");
}
{
  const D = "2026-09-24", ID = "sync-1";
  const { blankTask } = await import("../.out/core.mjs");
  await plugin.tasks.upsert(blankTask({ id: ID, title: "同步测试", category: "学习", date: D, start: "06:00", estimate: 30 }));
  const linked = () => (app.vault.files.get(`日记/${D}.md`) || "").split("\n").filter(line => line.includes(`[任务:: ${ID}]`));
  const row = () => [...root.querySelectorAll(".lubi-task")].find(row => row.querySelector(".lubi-task-title-text")?.textContent === "同步测试");
  const settle = async () => { for (let i = 0; i < 7; i++) await tick(); };
  const toggle = async () => { row().querySelector("input[type=checkbox]").click(); await settle(); };
  view.tasksState.period = "week"; view.show("tasks", D); await settle();
  for (let i = 0; i < 5; i++) { await toggle(); await toggle(); }
  check(linked().length === 0 && !plugin.tasks.isDoneOn(plugin.tasks.byId(ID), D), "completion: repeated check/uncheck creates no time records");
  row().querySelector("input[type=checkbox]").click(); row().querySelector("input[type=checkbox]").click(); await settle();
  check(plugin.tasks.isDoneOn(plugin.tasks.byId(ID), D) && linked().length === 0, "completion: rapid double click completes once without implicit time");
  const fill = row().querySelector(".lubi-task-unlogged");
  check(!!fill, "backfill: explicit planning-based action is available with valid inputs");
  fill.click(); await settle();
  check(linked().length === 1 && linked()[0].includes("[待确认:: 按计划]"), "backfill: explicit action creates one pending record");
  [...document.body.querySelectorAll(".lubi-notice-btn")].at(-1).click(); await settle();
  check(linked().length === 0 && plugin.tasks.isDoneOn(plugin.tasks.byId(ID), D), "backfill: undo affects only the created record, not completion");
  await plugin.journal.add({ date: D, start: "06:00", minutes: 30, category: "学习", title: "同步测试", task: ID, extra: { 自定义: "保留" } });
  await plugin.tasks.setDoneLog(ID, D, { date: D, start: "06:00", title: "同步测试", category: "学习" });
  await toggle();
  check(linked().length === 1 && !plugin.tasks.isDoneOn(plugin.tasks.byId(ID), D), "completion: reopening preserves actual records including legacy associations");
  view.show("today", D); await settle();
  let block = [...root.querySelectorAll(".lubi-block")].find(block => block.querySelector(".lubi-block-title")?.textContent === "同步测试");
  block.dispatchEvent(new window.FocusEvent("focus")); block.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })); await settle();
  check(linked()[0].startsWith("- 06:05") && linked()[0].includes("[自定义:: 保留]"), "completion: actual-record edits retain their data independently");
  view.tasksState.period = "week"; view.show("tasks", D); await settle(); await toggle(); await toggle();
  check(linked().length === 1, "completion: moved real records are not deleted by later state changes");
  await plugin.tasks.setDone(ID, D, true); view.show("today", D); await settle();
  block = [...root.querySelectorAll(".lubi-block")].find(block => block.querySelector(".lubi-block-title")?.textContent === "同步测试");
  block.querySelector('.lubi-block-actions [data-icon="trash-2"]').click(); await settle();
  check(linked().length === 0 && plugin.tasks.byId(ID) && plugin.tasks.isDoneOn(plugin.tasks.byId(ID), D), "deletion: removing an actual record preserves its planned task and completion");
  [...document.body.querySelectorAll(".lubi-notice-btn")].at(-1).click(); await settle();
  check(linked().length === 1 && plugin.tasks.isDoneOn(plugin.tasks.byId(ID), D), "deletion: undo restores the record without changing completion");
  await plugin.tasks.upsert({ ...plugin.tasks.byId(ID), repeat: { kind: "daily", days: [] }, status: "todo", doneDates: [D] });
  view.show("today", D); await settle();
  [...root.querySelectorAll(".lubi-block")].find(block => block.querySelector(".lubi-block-title")?.textContent === "同步测试").querySelector('.lubi-block-actions [data-icon="trash-2"]').click(); await settle();
  check(linked().length === 0 && plugin.tasks.isDoneOn(plugin.tasks.byId(ID), D), "deletion: repeated occurrence completion is also independent");
  await plugin.tasks.remove(ID);
  for (const notice of [...document.body.children]) if (notice.querySelector?.(".lubi-notice-btn")) notice.remove();
}
// ---------- 每日页新记的事 ↔ 任务页的已完成任务 ----------
{
  const D = "2026-09-24";
  const settle = async () => { for (let i = 0; i < 4; i++) await tick(); };
  view.show("today", D); await tick();
  openLegacyTime();
  const m = O.openModals.at(-1);
  const newModes = [...m.contentEl.querySelectorAll(".lubi-kind-seg .lubi-seg-item")].map((x) => x.textContent || "");
  check(m.constructor.name === "RecordModal" && newModes.length === 0, "record editor: existing timeline editor has no independent creation-mode tabs");
  check(![...m.contentEl.querySelectorAll(".lubi-ghost-btn")].some((b) => b.textContent.includes("关联")), "new: the manual 关联待办 field is gone");
  const tt = m.contentEl.querySelector('input[type="text"]'); tt.value = "补记午饭后散步"; tt.dispatchEvent(new window.Event("input"));
  const st = m.contentEl.querySelector('input[type="time"]'); st.value = "05:00"; st.dispatchEvent(new window.Event("change"));
  const du = m.contentEl.querySelector('input[type="number"]'); du.value = "20"; du.dispatchEvent(new window.Event("input"));
  m.contentEl.querySelector(".lubi-modal-actions .mod-cta").click(); await settle();
  const t = plugin.tasks.all.find((x) => x.title === "补记午饭后散步");
  check(!!t && t.origin === "record" && plugin.tasks.isDoneOn(t, D), "new: daily record creates a done task");
  view.tasksState.period = "week"; view.show("tasks", D); await tick();
  check(!root.querySelector(`[data-task-id="${t.id}"]`), "new: an actual-record task is excluded from planning presentations");
  view.show("today", D); await tick();
  check([...root.querySelectorAll(".lubi-task.is-done .lubi-task-title-text")].some(x => x.textContent === "补记午饭后散步"), "new: the generated done task remains in the daily task list");
  // 在每日页取消勾选 → 记录一起移除
  const r = [...root.querySelectorAll(".lubi-task")].find((x) => x.querySelector(".lubi-task-title-text")?.textContent === "补记午饭后散步");
  r.querySelector("input[type=checkbox]").click(); await settle();
  check(app.vault.files.get(`日记/${D}.md`).includes("补记午饭后散步"), "new: reopening a record-origin task preserves the real record");
  await plugin.tasks.setDone(t.id, D, true); await settle();
  check(app.vault.files.get(`日记/${D}.md`).includes("补记午饭后散步"), "new: completing again does not duplicate or alter the record");
  // 在每日页删除这条记录 → 任务一起删除，可撤销
  view.show("today", D); await tick();
  const b = [...root.querySelectorAll(".lubi-block")].find((x) => x.querySelector(".lubi-block-title")?.textContent === "补记午饭后散步");
  b.querySelector('.lubi-block-actions [data-icon="trash-2"]').click(); await settle();
  check(!plugin.tasks.byId(t.id) && !app.vault.files.get(`日记/${D}.md`).includes("补记午饭后散步"), "new: deleting the record also deletes its generated task");
  [...document.body.querySelectorAll(".lubi-notice-btn")].at(-1).click(); await settle();
  check(!!plugin.tasks.byId(t.id) && app.vault.files.get(`日记/${D}.md`).includes(`[任务:: ${t.id}]`), "new: undo restores both record and task");
  plugin.quickLog();await tick();
  const tm=O.openModals.at(-1);check(tm.constructor.name==='TaskModal'&&tm.contentEl.querySelector('[data-actual=minutes]'),'new: public creation is the task form with actual duration');
  tm.titleInput.value='明天买菜';tm.titleInput.dispatchEvent(new window.Event('input'));
  tm.contentEl.querySelector('[data-lubi-focus="seg:money"]').click();await tick();const spending=O.openModals.at(-1);
  check(spending.constructor.name==='RecordModal'&&spending.rec.title==='明天买菜','new: spending switch keeps the task draft');
  spending.contentEl.querySelector('[data-lubi-focus="seg:todo"]').click();await tick();const back=O.openModals.at(-1);
  check(back.constructor.name==='TaskModal'&&back.t.title==='明天买菜','new: returning from spending keeps the draft');back.close();
  await plugin.tasks.remove(t.id);
  await plugin.journal.remove(D, await plugin.journal.findLine(D, { start: "05:00", minutes: 20, category: t.category, title: "补记午饭后散步" }));
  for (const n of [...document.body.children]) if (n.querySelector?.(".lubi-notice-btn")) n.remove();
}
// ---------- 删除任务：关联记录默认保留并解除关联，可选一起删除；均可撤销 ----------
{
  const D = "2026-09-24";
  const settle = async () => { for (let i = 0; i < 4; i++) await tick(); };
  const mk = async (id, title, start) => {
    await plugin.tasks.upsert({ ...plugin.tasks.all[0], id, title, parent: null, status: "todo", blocked: false, date: D, start: "", estimate: 0, repeat: { kind: "none", days: [] }, doneDates: [], doneLogs: undefined, startDate: "", endDate: "" });
    await plugin.journal.add({ date: D, start, minutes: 15, category: "学习", title, task: id, extra: {} });
  };
  const jtext = () => app.vault.files.get(`日记/${D}.md`) || "";
  const openDelete = async (title) => {
    view.tasksState.period = "week"; view.show("tasks", D); await tick();
    const r = [...root.querySelectorAll(".lubi-task")].find((x) => x.querySelector(".lubi-task-title-text")?.textContent === title);
    r.querySelector(".lubi-task-title-button").click(); await tick();
    O.openModals.at(-1).contentEl.querySelector(".lubi-text-btn-danger").click(); await settle();
    return O.openModals.at(-1);
  };
  const undoLast = async () => { [...document.body.querySelectorAll(".lubi-notice-btn")].at(-1).click(); await settle(); };

  await mk("del-keep", "删除保留测试", "04:00");
  let m = await openDelete("删除保留测试");
  check(m.constructor.name === "DeleteTaskModal" && m.contentEl.querySelectorAll(".lubi-delete-opt").length === 2, "delete: linked records offer keep / remove choice");
  m.contentEl.querySelector(".lubi-btn-danger").click(); await settle();
  check(!plugin.tasks.byId("del-keep") && jtext().includes("删除保留测试") && !jtext().includes("[任务:: del-keep]"), "delete: default keeps the record and strips the link");
  check(!O.openModals.some((x) => x.constructor.name === "TaskModal" || x.constructor.name === "DeleteTaskModal"), "delete: dialogs close after deleting");
  await undoLast();
  check(!!plugin.tasks.byId("del-keep") && jtext().includes("[任务:: del-keep]"), "delete: undo restores task and link");

  await mk("del-rm", "删除记录测试", "04:30");
  m = await openDelete("删除记录测试");
  m.contentEl.querySelectorAll(".lubi-delete-opt input")[1].click();
  m.contentEl.querySelector(".lubi-btn-danger").click(); await settle();
  check(!plugin.tasks.byId("del-rm") && !jtext().includes("删除记录测试"), "delete: remove option deletes linked records");
  await undoLast();
  check(!!plugin.tasks.byId("del-rm") && jtext().includes("[任务:: del-rm]"), "delete: undo restores task and deleted record");

  // 取消删除：任务和编辑窗口都保留
  m = await openDelete("删除记录测试");
  m.contentEl.querySelector(".lubi-modal-actions .lubi-btn-ghost").click(); await tick();
  check(!!plugin.tasks.byId("del-rm") && O.openModals.at(-1)?.constructor.name === "TaskModal", "delete: cancel keeps task and its edit dialog");
  O.openModals.at(-1).close();

  // 任务已不存在时，时间轴不再显示「关联任务」
  await plugin.tasks.remove("del-rm");
  view.show("today", D); await tick();
  const blk = [...root.querySelectorAll(".lubi-block-title")].find((b) => b.textContent === "删除记录测试")?.closest("[class*=lubi-block]")?.parentElement;
  const keep = [...root.querySelectorAll(".lubi-block-title")].find((b) => b.textContent === "删除保留测试");
  check(!!blk && !blk.textContent.includes("关联任务"), "timeline hides link label when the task is gone");
  check(!!keep && keep.parentElement.parentElement.textContent.includes("关联任务"), "timeline still labels links to existing tasks");

  await plugin.tasks.remove("del-keep");
  for (const [s, t] of [["04:00", "删除保留测试"], ["04:30", "删除记录测试"]]) await plugin.journal.remove(D, await plugin.journal.findLine(D, { start: s, minutes: 15, category: "学习", title: t }));
  for (const n of [...document.body.children]) if (n.querySelector?.(".lubi-notice-btn")) n.remove();
}
// ---------- Editing task status and explicit backfill are independent ----------
{
  const D = "2026-09-24", ID = "log-miss";
  const { blankTask } = await import("../.out/core.mjs");
  const settle = async () => { for (let i = 0; i < 7; i++) await tick(); };
  await plugin.tasks.upsert(blankTask({ id: ID, title: "漏记测试", category: "学习", date: D, start: "03:00", estimate: 20 }));
  const linked = () => (app.vault.files.get(`日记/${D}.md`) || "").split("\n").filter(line => line.includes(`[任务:: ${ID}]`));
  const row = () => [...root.querySelectorAll(".lubi-task")].find(row => row.querySelector(".lubi-task-title-text")?.textContent === "漏记测试");
  const setStatus = async status => {
    row().querySelector(".lubi-task-title-button").click(); await tick();
    const form = O.openModals.at(-1); form.contentEl.querySelector(`.lubi-status-seg [data-task-status="${status}"]`).click();
    form.contentEl.querySelector(".lubi-modal-actions .mod-cta").click(); await settle();
  };
  view.tasksState.period = "week"; view.show("tasks", D); await settle();
  await setStatus("done");
  check(linked().length === 0 && plugin.tasks.byId(ID).status === "done", "status: editing completion does not fabricate actual time");
  row().querySelector(".lubi-task-unlogged").click(); await settle();
  check(linked().length === 1 && linked()[0].includes("[待确认:: 按计划]"), "status: backfill is explicit and pending");
  await setStatus("todo");
  check(linked().length === 1 && plugin.tasks.byId(ID).status === "todo", "status: editing back to todo preserves time data");
  await plugin.journal.remove(D, await plugin.journal.findLine(D, { start: "03:00", minutes: 20, category: "学习", title: "漏记测试" }));
  plugin.settings.promptLogOnComplete = false; view.show("tasks", D); await settle();
  check(!!row().querySelector(".lubi-task-unlogged"), "status: explicit backfill is not controlled by the obsolete auto-log preference");
  await plugin.tasks.remove(ID);
  for (const notice of [...document.body.children]) if (notice.querySelector?.(".lubi-notice-btn")) notice.remove();
}
// 快速添加待办
view.tasksState.period = "week"; view.show("tasks", "2026-09-24"); await tick();
const qa = root.querySelector(".lubi-quick-add input"); qa.value = "买牛奶"; qa.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter" })); await tick(); await tick();
check(plugin.tasks.all.some((t) => t.title === "买牛奶" && t.date === "2026-09-24"), "quick add creates dated task");
// 拖放安排
const milk = plugin.tasks.all.find((t) => t.title === "买牛奶");
await plugin.tasks.schedule(milk.id, "2026-09-25", "09:15");
check(plugin.tasks.byId(milk.id).start === "09:15" && plugin.tasks.forDate("2026-09-25").some((t) => t.id === milk.id), "schedule moves task");
// 编辑任务状态：视觉状态由 aria-pressed / 勾号决定，保存前不写盘；取消放弃草稿。
view.show("tasks", "2026-09-25"); await tick();
const milkRow = [...root.querySelectorAll(".lubi-task")].find((row) => row.querySelector(".lubi-task-title-text")?.textContent === "买牛奶");
check(!!milkRow?.querySelector(".lubi-task-title-button"), "task row provides an edit entry for its full title");
milkRow.querySelector(".lubi-task-title-button").click();
const statusDraft = O.openModals.at(-1);
const statusBtn = (modal, value) => modal.contentEl.querySelector(`.lubi-status-seg [data-task-status="${value}"]`);
check(statusBtn(statusDraft, "todo")?.getAttribute("aria-pressed") === "true" && !!statusBtn(statusDraft, "todo")?.querySelector(".lubi-status-check"), "initial task state is marked in the modal");
statusBtn(statusDraft, "doing").click();
check(statusBtn(statusDraft, "doing")?.getAttribute("aria-pressed") === "true" && statusBtn(statusDraft, "todo")?.getAttribute("aria-pressed") === "false", "clicking task state updates selected button immediately");
await tick();
check(statusDraft.titleEl.querySelector(".lubi-dirty")?.classList.contains("is-on") && !statusDraft.contentEl.querySelector(".lubi-status-hint"), "status change is flagged only by the unsaved marker");
check(plugin.tasks.byId(milk.id).status === "todo", "state draft is not persisted before save");
statusDraft.contentEl.querySelector(".lubi-modal-actions .lubi-btn-ghost").click();
check(!O.openModals.includes(statusDraft) && plugin.tasks.byId(milk.id).status === "todo", "cancel leaves task state unchanged");
milkRow.querySelector(".lubi-task-title-button").click();
const statusSaved = O.openModals.at(-1);
statusBtn(statusSaved, "done").click();
statusSaved.contentEl.querySelector(".lubi-quick-chip-warn").click();
check(statusBtn(statusSaved, "done")?.getAttribute("aria-pressed") === "true" && statusSaved.contentEl.querySelector(".lubi-quick-chip-warn")?.getAttribute("aria-pressed") === "true", "done and blocked draft both provide selected-state feedback");
statusSaved.contentEl.querySelector(".lubi-modal-actions .mod-cta").click(); await tick(); await tick();
check(plugin.tasks.byId(milk.id).status === "done" && plugin.tasks.byId(milk.id).blocked === true && !O.openModals.includes(statusSaved), "save persists the selected state and closes modal");

// ---------- 二期：拖动 / 模态 / 图表 ----------
if (!window.PointerEvent) window.PointerEvent = class extends window.MouseEvent { constructor(t, o = {}) { super(t, o); this.pointerId = o.pointerId ?? 1; } };
const pe = (el, type, y, x = 0, extra = {}) => el.dispatchEvent(new window.PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 1, ...extra }));
const drag = async (el, y0, y1, x0 = 0, x1 = 0, opts = {}) => { pe(el, "pointerdown", y0, x0); pe(window, "pointermove", y0 + 3, x0); pe(window, "pointermove", y1, x1, opts); if (opts.cancel) window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); else pe(window, "pointerup", y1, x1, opts); await tick(); await tick(); await new Promise((r) => setTimeout(r, 200)); };
const PXM = 56 / 60;
const journal = () => app.vault.files.get("日记/2026-09-24.md");
for (const n of [...document.body.children]) if (n.querySelector?.(".lubi-notice-btn")) n.remove();
view.show("today", "2026-09-24"); await tick(); await new Promise((r) => setTimeout(r, 200));
// 1. 拖动移动：写测试 20:00 → 21:00
let b = blocks().find((x) => x.textContent.includes("写测试"));
check(!!b && b.querySelector(".lubi-block-handle.is-top") && b.querySelector(".lubi-block-handle.is-bottom"), "block has resize handles");
await drag(b, 20 * 60 * PXM + 10, 21 * 60 * PXM + 10);
check(journal().includes("- 21:00–21:45 学习 · 写测试"), "drag move shifts record by 1h: " + (journal().match(/.*写测试.*/) || [""])[0]);
check(O.notices.at(-1) === "" && document.body.querySelector(".lubi-notice-btn"), "undo notice shown after drag");
// 2. 撤销
document.body.querySelector(".lubi-notice-btn").click(); await tick(); await tick(); await new Promise((r) => setTimeout(r, 200));
check(journal().includes("- 20:00–20:45 学习 · 写测试"), "undo restores original time");
// 3. 拉伸下边缘 +30min
b = blocks().find((x) => x.textContent.includes("写测试"));
await drag(b.querySelector(".lubi-block-handle.is-bottom"), 20.75 * 60 * PXM, 21.25 * 60 * PXM);
check(journal().includes("- 20:00–21:15 学习 · 写测试 [时长:: 1.25h]"), "resize-end extends by 30min: " + (journal().match(/.*写测试.*/) || [""])[0]);
// 4. 拉伸上边缘 -15min（Shift 1 分钟粒度不测）
b = blocks().find((x) => x.textContent.includes("写测试"));
await drag(b.querySelector(".lubi-block-handle.is-top"), 20 * 60 * PXM, 19.75 * 60 * PXM);
check(journal().includes("- 19:45–21:15 学习 · 写测试 [时长:: 1.5h]"), "resize-start moves start earlier: " + (journal().match(/.*写测试.*/) || [""])[0]);
// 5. Esc 取消
b = blocks().find((x) => x.textContent.includes("写测试"));
await drag(b, 20 * 60 * PXM, 22 * 60 * PXM, 0, 0, { cancel: true });
check(journal().includes("- 19:45–21:15 学习 · 写测试"), "Esc cancels drag, file untouched");
check(!document.body.classList.contains("lubi-dragging"), "dragging class cleaned up");
// 6. 点击（无位移）仍然打开编辑
b = blocks().find((x) => x.textContent.includes("写测试"));
{ const n = O.openModals.length; pe(b, "pointerdown", 20 * 60 * PXM); pe(window, "pointerup", 20 * 60 * PXM); await tick();
  check(O.openModals.length === n + 1, "click without movement opens edit modal");
  const em = O.openModals.at(-1);
  check(em.titleEl.textContent.includes("编辑记录") && em.titleEl.textContent.includes("19:45–21:15"), "modal title shows date + original span: " + em.titleEl.textContent);
  check(!!em.contentEl.querySelector(".lubi-timebar") && em.contentEl.querySelectorAll(".lubi-ghost-btn").length === 1, "modal has timebar + notes toggle only");
  check(em.contentEl.querySelector('.lubi-quick-chip[aria-pressed="true"]')?.textContent === "1.5h", "quick chip highlights current duration");
  em.contentEl.querySelectorAll(".lubi-ghost-btn")[0].click(); await tick();
  check(!!em.contentEl.querySelector("textarea"), "notes field appears after ghost click");
  check(!!em.contentEl.querySelector(".lubi-text-btn-danger"), "delete is a text button");
  em.close(); }
// 7. 空白处框选新建 → 模态预填
{ const canvas = root.querySelector(".lubi-tl-canvas"); const n = O.openModals.length;
  await drag(canvas, 10 * 60 * PXM, 11 * 60 * PXM);
  check(O.openModals.length === n + 1, "drag on empty area opens new-record modal");
  const nm = O.openModals.at(-1);
  check(nm.constructor.name==="TaskModal"&&nm.actualStart==="10:00"&&nm.actualText==="1h"&&nm.t.estimate===0,"actual entry: drag selection fills actual interval, not estimated planning duration");
  nm.close(); }
// 8. 键盘微调
b = blocks().find((x) => x.textContent.includes("写测试"));
pe(b, "pointerdown", 20 * 60 * PXM); pe(window, "pointerup", 20 * 60 * PXM); await tick(); O.openModals.at(-1)?.close();
root.querySelector(".lubi-timeline").dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); await tick(); await tick(); await new Promise((r) => setTimeout(r, 200));
check(journal().includes("- 19:50–21:20 学习 · 写测试"), "ArrowDown nudges 5min: " + (journal().match(/.*写测试.*/) || [""])[0]);
// 9. 回顾图表
view.review.period = "week"; view.show("review", "2026-09-24"); await tick(); await tick();
check(root.querySelectorAll(".lubi-chart-gridline").length === 4, "chart has 4 gridlines (6/12/18/24h)");
check(!!root.querySelector(".lubi-bar-val.is-over"), "103h day flagged as over-cap");
check(root.querySelector(".lubi-kpi")?.textContent.includes("记录总时长") && root.querySelector(".lubi-kpis")?.textContent.includes("待校对异常日后计算"), "anomalous day does not yield a misleading daily average");
check(root.querySelector(".lubi-chart-avg-label")?.textContent.startsWith("有效日均") && !root.querySelector(".lubi-chart-avg-label")?.textContent.includes("103"), "anomalous bar is excluded from chart average");
check(!root.querySelector(".lubi-bar-stack[style*='height: 100%']:not(.is-over)"), "no non-over bar at full height");
check(root.querySelectorAll(".lubi-chart-legend-item").length >= 1, "chart legend rendered");
// 9b. tooltip 不残留：悬停出现 → 重绘后消失 → 离开后消失
{ const barsEl = root.querySelector(".lubi-bars"); const col = root.querySelector(".lubi-bar-col");
  col.dispatchEvent(new window.PointerEvent("pointermove", { bubbles: true, clientX: 10, clientY: 10 }));
  await new Promise(resolve => setTimeout(resolve, 280));
  check(document.body.querySelectorAll(".lubi-tip").length === 1, "tooltip appears on hover");
  const col2 = root.querySelectorAll(".lubi-bar-col")[3];
  col2.dispatchEvent(new window.PointerEvent("pointermove", { bubbles: true, clientX: 20, clientY: 10 }));
  await new Promise(resolve => setTimeout(resolve, 280));
  check(document.body.querySelectorAll(".lubi-tip").length === 1, "still exactly one tooltip after moving to another bar");
  view.show("review"); await tick(); await tick();
  check(document.body.querySelectorAll(".lubi-tip").length === 0, "tooltip removed on re-render");
  const c3 = root.querySelector(".lubi-bar-col"); c3.dispatchEvent(new window.PointerEvent("pointermove", { bubbles: true, clientX: 10, clientY: 10 }));
  root.querySelector(".lubi-bars").dispatchEvent(new window.PointerEvent("pointerleave", { bubbles: false }));
  check(document.body.querySelectorAll(".lubi-tip").length === 0, "tooltip removed on pointerleave");
  void barsEl; }
// 9c. 回顾 → 点柱子跳到每日页 → 再点顶栏「回顾」能回来
{ view.show("review"); await tick(); await tick();
  const col = [...root.querySelectorAll(".lubi-bar-col")].find((c) => !c.classList.contains("is-empty")) || root.querySelector(".lubi-bar-col");
  col.click(); await tick(); await tick();
  check(view.tab === "tasks" && view.tasksState.period === "day" && view.tasksState.scheduleView === "calendar", "clicking a bar jumps to planning calendar day");
  const tabs = [...root.querySelectorAll(".lubi-topbar-tabs .lubi-seg-item")];
  check(tabs[0].getAttribute("aria-pressed") === "true" && tabs[1].getAttribute("aria-pressed") === "false", "top tabs reflect the jump");
  tabs.find(b=>b.dataset.lubiFocus === "seg:review").click(); await tick(); await tick();
  check(view.tab === "review" && root.querySelector(".lubi-bars") !== null, "clicking 回顾 returns to review page"); }
// 10. 周日程 pointer 拖动：跨列 + 改时间
plugin.settings.scheduleStartHour = 0; view.tasksState.period = "week"; view.show("tasks", "2026-09-24"); await tick(); // 窗口固定为 9/21–9/27
{ const cols = [...root.querySelectorAll(".lubi-week-day-button")].map((b) => document.getElementById(b.getAttribute("aria-labelledby"))?.textContent || ""); check(cols.length === 7 && cols[3].includes("2026-09-24"), `week window centred on anchor: ${cols[3]}`); }
const wb = root.querySelector(".lubi-wblock");
const wt = plugin.tasks.all.find((t) => t.title === wb.querySelector(".lubi-wblock-title").textContent);
const beforeDate = plugin.tasks.forDate("2026-09-25").some((t) => t.id === wt.id) ? "2026-09-25" : null;
const origStart = wt.start;
await drag(wb, 100, 100 + 56, 0, 1);
const after = plugin.tasks.byId(wt.id);
check(after.start === (() => { const [h, m] = origStart.split(":").map(Number); const v = Math.round((h * 60 + m + 60) / 15) * 15; return `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`; })(), `week block moved +1h (snapped to 15min): ${origStart} → ${after.start}`);
check(plugin.tasks.forDate("2026-09-25").some((t) => t.id === wt.id) !== !!beforeDate, `week block moved to next column (was ${beforeDate ? "9/25" : "other day"})`);
const wb2 = [...root.querySelectorAll(".lubi-wblock")].find((x) => x.querySelector(".lubi-wblock-title").textContent === wt.title);
check(!!wb2.querySelector(".lubi-block-handle.is-bottom"), "week block has resize handle");
const est0 = plugin.tasks.byId(wt.id).estimate || 30;
await drag(wb2.querySelector(".lubi-block-handle.is-bottom"), 200, 200 + 24);
check((plugin.tasks.byId(wt.id).estimate || 0) === est0 + 30, `week block resize +30min estimate: ${est0} → ${plugin.tasks.byId(wt.id).estimate}`);
// 11. 周日程 上边缘拉伸：开始提前 30min，预计 +30
const wb3 = [...root.querySelectorAll(".lubi-wblock")].find((x) => x.querySelector(".lubi-wblock-title").textContent === wt.title);
const s0 = plugin.tasks.byId(wt.id).start, e0 = plugin.tasks.byId(wt.id).estimate;
await drag(wb3.querySelector(".lubi-block-handle.is-top"), 300, 300 - 24);
{ const t2 = plugin.tasks.byId(wt.id); const toMin = (hm) => { const [h, m] = hm.split(":").map(Number); return h * 60 + m; };
  check(toMin(t2.start) === toMin(s0) - 30 && t2.estimate === e0 + 30, `week block resize-start: ${s0}/${e0} → ${t2.start}/${t2.estimate}`); }
// 12a. 周日程空白处拖出新任务（与每日页时间轴一致）
{
  view.tasksState.period = "week"; view.show("tasks", "2026-09-24"); await tick();
  const cols = [...root.querySelectorAll(".lubi-week-col")];
  const wkDays = [...root.querySelectorAll(".lubi-week-day-button")].map((b) => document.getElementById(b.getAttribute("aria-labelledby")).textContent.match(/\d{4}-\d{2}-\d{2}/)[0]);
  const ci = 2, col = cols[ci], sh = plugin.settings.scheduleStartHour, px = 56 / 60;
  const yAt = (hm) => { const [h, m] = hm.split(":").map(Number); return ((h - sh) * 60 + m) * px + 1; };
  const before = O.openModals.length;
  const ghostOn = () => col.querySelector(".lubi-wghost.is-on");
  pe(col, "pointerdown", yAt("09:00"), 0); pe(window, "pointermove", yAt("09:00") + 5, 0); pe(window, "pointermove", yAt("10:30"), 0);
  check(!!ghostOn() && ghostOn().textContent.includes("09:00–10:30"), `week create: dashed preview follows the drag (${ghostOn()?.textContent})`);
  pe(window, "pointerup", yAt("10:30"), 0); await tick(); await tick();
  const m = O.openModals.at(-1);
  check(O.openModals.length === before + 1 && m.constructor.name === "TaskModal" && m.t.date === wkDays[ci] && m.t.start === "09:00" && m.t.estimate === 90, `week create: drag opens new task prefilled (${m.t?.date} ${m.t?.start} ${m.t?.estimate})`);
  check(!ghostOn(), "week create: preview hidden after release");
  m.close();
  // 向上拖同样可以
  pe(col, "pointerdown", yAt("15:00"), 0); pe(window, "pointermove", yAt("15:00") - 5, 0); pe(window, "pointermove", yAt("14:00"), 0); pe(window, "pointerup", yAt("14:00"), 0); await tick();
  const up = O.openModals.at(-1);
  check(up.constructor.name === "TaskModal" && up.t.start === "14:00" && up.t.estimate === 60, `week create: dragging upward works (${up.t?.start} ${up.t?.estimate})`);
  up.close();
  // Esc 取消 / 单击不新建
  const n0 = O.openModals.length;
  pe(col, "pointerdown", yAt("11:00"), 0); pe(window, "pointermove", yAt("11:00") + 5, 0); pe(window, "pointermove", yAt("12:00"), 0);
  window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await tick();
  pe(col, "pointerdown", yAt("13:00"), 0); pe(window, "pointerup", yAt("13:00"), 0); await tick();
  check(O.openModals.length === n0 && !ghostOn(), "week create: Esc cancels and a plain click creates nothing");
  // 保存后出现在周日程
  pe(col, "pointerdown", yAt("07:00"), 0); pe(window, "pointermove", yAt("07:00") + 5, 0); pe(window, "pointermove", yAt("07:45"), 0); pe(window, "pointerup", yAt("07:45"), 0); await tick();
  const nm = O.openModals.at(-1);
  const ti = nm.contentEl.querySelector("input[type=text]"); ti.value = "拖出的任务"; ti.dispatchEvent(new window.Event("input", { bubbles: true }));
  nm.contentEl.querySelector(".lubi-modal-actions .mod-cta").click(); await tick(); await tick();
  await tick(); await tick();
  const made = plugin.tasks.all.find((t) => t.title === "拖出的任务");
  await new Promise((r) => setTimeout(r, 300));
  check(!!made && made.date === wkDays[ci] && made.start === "07:00" && made.estimate === 45 && [...root.querySelectorAll(".lubi-wblock-title")].some((x) => x.textContent === "拖出的任务"), "week create: saved task appears on the schedule");
  if (made) await plugin.tasks.remove(made.id);
}
// Project panel removal changes presentation only: hierarchy, progress and spans remain available.
{
  const snapshot=JSON.stringify(plugin.tasks.all),files=JSON.stringify([...app.vault.files]);
  view.show("tasks","2026-09-24");await tick();await tick();
  check(!root.querySelector(".lubi-tasks-projects, .lubi-gantt, .lubi-project-toggle"),"planning: no standalone project panel or Gantt remains");
  check(JSON.stringify(plugin.tasks.all)===snapshot && JSON.stringify([...app.vault.files])===files,"planning: removing the panel does not rewrite task hierarchy or records");
  const parent=plugin.tasks.projects().find(p=>plugin.tasks.children(p.id).length && [...root.querySelectorAll("button.lubi-task-group-title")].some(b=>b.textContent.includes(p.title)));
  check(!!parent && plugin.tasks.progress(parent).total>0 && !!plugin.tasks.span(parent),"planning: parent/child data, progress and date-span model remain intact");
  const group=[...root.querySelectorAll("button.lubi-task-group-title")].find(b=>b.textContent.includes(parent.title));
  check(!!group,"planning: parent task remains accessible through the existing list group");
  group?.click();await tick();
  const editor=O.openModals.at(-1);
  check(editor?.constructor.name==="TaskModal" && editor.t.id===parent.id,"planning: parent-task group still opens the normal task editor");editor?.close();
  check(JSON.stringify(plugin.tasks.all)===snapshot && JSON.stringify([...app.vault.files])===files,"planning: opening/cancelling parent editor does not alter data");
}
// ---------- UX 回归：页面日期、表单键盘、异常/表格、任务撤销 ----------
await new Promise((resolve) => setTimeout(resolve, 200));
view.show("today", "2026-09-13"); await tick(); await tick();
check(root.querySelector(".lubi-today-side")?.textContent.includes("9/13 分布"), "historical summary uses selected date");
check(!root.querySelector(".lubi-today-side .lubi-day-tasks"), "daily side panel no longer repeats the task list");
root.querySelector(".lubi-timeline-scroll").scrollTop = 320;
view.show("review", "2026-09-24"); await tick(); await tick();
check(root.dataset.tab === "review", "non-day tab exposes context for hiding day navigation");
view.show("today"); await tick(); await tick();
check(view.date === "2026-09-13" && root.querySelector(".lubi-timeline-scroll")?.scrollTop === 320, "tab switch restores date and timeline scroll");
view.show("today", "2026-09-24"); await tick();
openLegacyTime();
const keyboardRecord = O.openModals.at(-1);
const recordTitle = keyboardRecord.contentEl.querySelector('input[type="text"]');
const recordDuration = keyboardRecord.contentEl.querySelector('input[type="number"]');
recordDuration.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
check(O.openModals.includes(keyboardRecord), "Enter on duration does not submit the record");
keyboardRecord.contentEl.querySelector(".lubi-cat-option").dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
check(O.openModals.includes(keyboardRecord), "Enter on category does not submit the record");
recordTitle.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
check(recordTitle.getAttribute("aria-invalid") === "true" && !!keyboardRecord.contentEl.querySelector(".lubi-field-error"), "empty title shows adjacent error and focusable invalid field");
recordTitle.value = "键盘记录"; recordTitle.dispatchEvent(new window.Event("input", { bubbles: true }));
const recordTime = keyboardRecord.contentEl.querySelector('input[type="time"]');
recordTime.value = "18:00"; recordTime.dispatchEvent(new window.Event("change", { bubbles: true }));
recordDuration.value = "15"; recordDuration.dispatchEvent(new window.Event("input", { bubbles: true }));
recordTitle.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
await tick(); await tick();
check(!O.openModals.includes(keyboardRecord) && app.vault.files.get("日记/2026-09-24.md").includes("键盘记录"), "Enter on valid title saves record");
openLegacyTime();
const invalidRecord = O.openModals.at(-1);
const invalidTitle = invalidRecord.contentEl.querySelector('input[type="text"]');
invalidTitle.value = "超出上限"; invalidTitle.dispatchEvent(new window.Event("input", { bubbles: true }));
const invalidStart = invalidRecord.contentEl.querySelector('input[type="time"]');
invalidStart.value = "00:00"; invalidStart.dispatchEvent(new window.Event("change", { bubbles: true }));
const tooLong = invalidRecord.contentEl.querySelector('input[type="number"]');
tooLong.value = "1440"; tooLong.dispatchEvent(new window.Event("input", { bubbles: true }));
invalidRecord.contentEl.querySelector(".lubi-modal-actions .mod-cta").click(); await tick();
check(O.openModals.includes(invalidRecord) && invalidRecord.contentEl.querySelector(".lubi-modal-error") && invalidTitle.value === "超出上限", "save error keeps draft and explains failure in modal");
invalidRecord.close();
view.show("review", "2026-09-24"); await tick(); await tick();
check(!!root.querySelector(".lubi-data-warning .lubi-btn"), "legacy out-of-day record has a visible correction entry");
const focusBar = root.querySelector(".lubi-bar-col"); focusBar.focus();
check(!!document.body.querySelector(".lubi-tip") && focusBar.querySelector(".lubi-sr-only")?.textContent.includes("覆盖"), "review chart explains values on keyboard focus");
check(!root.querySelector(".lubi-bar-col[aria-label], .lubi-bar-col[title]"), "tooltip: chart bars show only the custom hover card");
focusBar.blur();
const tableChoice = [...root.querySelectorAll(".lubi-chart-mode button")].find((x) => x.textContent === "表格");
tableChoice.focus(); tableChoice.click(); await tick(); await tick();
check(document.activeElement?.textContent === "表格", "chart/table switch retains keyboard focus after redraw");
check(!root.querySelector(".lubi-review-table-wrap").hidden && !!root.querySelector(".lubi-review-table caption"), "chart has readable table alternative");
check(root.querySelector(".lubi-review-table")?.textContent.includes("2026-09-21"), "table names the abnormal date to correct");
await plugin.journal.add({ date: "2026-10-12", start: "09:00", minutes: 60, category: "学习", title: "一期有效记录", extra: {} });
view.review.period = "week"; view.show("review", "2026-10-12"); await tick(); await tick();
check(!root.textContent.includes("至少 2 天"), "sparse comparison does not claim a trend");
view.tasksState.period = "week"; view.show("tasks", "2026-09-24"); await tick(); await tick();
check(root.querySelector(".lubi-planning-head")&&root.querySelector(".lubi-week"), "planning keeps the selected presentation and shared controls instead of a separate narrow agenda");
const visibleOrder = [...root.querySelectorAll(".lubi-tasks-left > .lubi-selected-day-list, .lubi-tasks-left > .lubi-inbox-card, .lubi-tasks-left > .lubi-agenda-host")].map((node) => node.classList.contains("lubi-agenda-host") ? "agenda" : node.textContent.includes("未安排") ? "inbox" : "today");
check(JSON.stringify(visibleOrder) === JSON.stringify(["today", "inbox"]), "selected-day list precedes inbox without a duplicate narrow agenda");
// 原生拖放：未安排 → 上方选中日清单（整个卡片都是落点）。
const taskTransfer = () => ({
  values: new Map(), types: [], effectAllowed: "", dropEffect: "",
  setData(type, value) { this.values.set(type, value); if (!this.types.includes(type)) this.types.push(type); },
  getData(type) { return this.values.get(type) || ""; },
});
const dispatchTaskDrop = (target, type, transfer, relatedTarget = null) => {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, { dataTransfer: { value: transfer }, relatedTarget: { value: relatedTarget } });
  target.dispatchEvent(event);
  return event;
};
const inboxSource = root.querySelector('button[data-lubi-tip^="安排 待安排事项 1 到"]').closest(".lubi-task");
const inboxTransfer = taskTransfer();
dispatchTaskDrop(inboxSource, "dragstart", inboxTransfer);
check(inboxTransfer.getData("text/lubi-task") === "inbox-0" && inboxTransfer.effectAllowed === "move", "inbox drag carries task id and move semantics");
const selectedCard = root.querySelector(".lubi-selected-day-list");
const unrelatedTransfer = taskTransfer(); unrelatedTransfer.setData("text/plain", "普通文字");
check(!dispatchTaskDrop(selectedCard, "dragover", unrelatedTransfer).defaultPrevented && !selectedCard.classList.contains("is-drop"), "day list ignores external text drags");
check(dispatchTaskDrop(selectedCard.querySelector(".lubi-panel-title"), "dragover", inboxTransfer).defaultPrevented && selectedCard.classList.contains("is-drop") && inboxTransfer.dropEffect === "move", "whole day card accepts inbox drag and highlights");
dispatchTaskDrop(selectedCard, "dragleave", inboxTransfer, selectedCard.querySelector("input"));
check(selectedCard.classList.contains("is-drop"), "moving between child elements keeps day drop highlight");
dispatchTaskDrop(selectedCard, "dragleave", inboxTransfer);
check(!selectedCard.classList.contains("is-drop"), "leaving day card clears drop highlight");
const journalsBeforeInboxDrop = [...app.vault.files].filter(([path]) => path.startsWith("日记/"));
const modalsBeforeInboxDrop = O.openModals.length;
dispatchTaskDrop(selectedCard.querySelector(".lubi-task-list"), "drop", inboxTransfer);
// DashboardView.refresh 合并刷新：等 150ms 防抖结束再断言可见列表。
await new Promise(resolve => setTimeout(resolve, 220)); await tick();
const droppedInboxTask = plugin.tasks.byId("inbox-0");
check(droppedInboxTask.date === "2026-09-24" && droppedInboxTask.start === "" && droppedInboxTask.status === "todo", "drop schedules selected date as all-day without completing task");
check(JSON.parse(app.vault.files.get("任务/任务数据.json")).tasks.find(t => t.id === "inbox-0").date === "2026-09-24", "inbox drop persists to task file");
check(!plugin.tasks.inbox().some(t => t.id === "inbox-0") && root.querySelector(".lubi-selected-day-list").textContent.includes("待安排事项 1"), "dropped task moves from inbox into day list");
check(O.openModals.length === modalsBeforeInboxDrop && JSON.stringify([...app.vault.files].filter(([path]) => path.startsWith("日记/"))) === JSON.stringify(journalsBeforeInboxDrop), "drop opens no modal and creates no records");
[...document.body.querySelectorAll(".lubi-notice-btn")].at(-1).click(); await tick(); await tick();
check(plugin.tasks.byId("inbox-0").date === "" && plugin.tasks.inbox().some(t => t.id === "inbox-0"), "undo drop returns task to inbox");
// 空日期列表也接受拖放，目标是所选日期而非系统当天。
view.show("tasks", "2030-01-02"); await tick(); await tick();
const emptyDayCard = root.querySelector(".lubi-selected-day-list");
check(!emptyDayCard.querySelector(".lubi-task"), "drop fixture has an empty selected-day list");
dispatchTaskDrop(emptyDayCard.querySelector(".lubi-muted.lubi-pad"), "drop", inboxTransfer); await tick(); await tick();
check(plugin.tasks.byId("inbox-0").date === "2030-01-02", "empty day card accepts drop using selected date");
[...document.body.querySelectorAll(".lubi-notice-btn")].at(-1).click(); await tick(); await tick();
view.tasksState.period = "week"; view.show("tasks", "2026-09-24"); await tick(); await tick();

// 全天任务摘要：避免 Obsidian aria-label 原生黑色提示，鼠标/键盘共用卡片。
{
  const { blankTask } = await import("../.out/core.mjs");
  const D = "2030-02-01", ID = "tooltip-all-day";
  await plugin.tasks.upsert(blankTask({ id: ID, title: "全天摘要夹具", date: D, estimate: 45, notes: "第一行备注\n第二行备注\n<img src=x onerror=alert(1)>" }));
  view.tasksState.period = "week"; view.show("tasks", D); await new Promise(resolve => setTimeout(resolve, 220)); await tick();
  const chip = () => [...root.querySelectorAll(".lubi-allday-chip")].find(el => el.textContent.includes("全天摘要夹具"));
  const taskChip = chip();
  check(!taskChip.hasAttribute("aria-label") && !taskChip.hasAttribute("title") && !!document.getElementById(taskChip.getAttribute("aria-labelledby")), "task tooltip: accessible summary avoids native tooltip attributes");
  taskChip.getBoundingClientRect = () => ({ left: 200, right: 300, top: 100, bottom: 120, height: 20, width: 100 });
  taskChip.dispatchEvent(new window.MouseEvent("pointermove", { bubbles: true, clientX: 250, clientY: 110 }));
  await new Promise(resolve => setTimeout(resolve, 280));
  let summaryTip = document.body.querySelector(".lubi-tip");
  check(summaryTip?.querySelector(".lubi-task-tip-title")?.textContent === "全天摘要夹具" && summaryTip.textContent.includes("全天（未设置开始时间）") && summaryTip.textContent.includes("预计用时：45min") && summaryTip.textContent.includes("待完成"), "task tooltip: title, all-day explanation, task estimate, and status are separate rows");
  check(summaryTip?.style.left === "310px" && summaryTip.style.top === "100px", "task tooltip: prefers beside the task instead of following the mouse over neighbors");
  check(summaryTip?.querySelector(".lubi-task-tip-notes")?.textContent.includes("<img") && !summaryTip.querySelector("img") && !summaryTip.querySelector(".lubi-task-tip-help") && !summaryTip.textContent.includes("点击编辑"), "task tooltip: notes are plain text and no operation footer is rendered");
  taskChip.dispatchEvent(new window.Event("pointerleave"));
  check(!document.body.querySelector(".lubi-tip"), "task tooltip: leave removes the card");
  taskChip.focus();
  check(!!document.body.querySelector(".lubi-tip .lubi-task-tip-title"), "task tooltip: keyboard focus shows the same summary");
  taskChip.blur();
  await plugin.tasks.upsert({ ...plugin.tasks.byId(ID), status: "done", estimate: 0, notes: "" });
  view.tasksState.period = "week"; view.show("tasks", D); await new Promise(resolve => setTimeout(resolve, 220)); await tick();
  chip().dispatchEvent(new window.MouseEvent("pointermove", { bubbles: true, clientX: 0, clientY: 0 }));
  await new Promise(resolve => setTimeout(resolve, 280));
  summaryTip = document.body.querySelector(".lubi-tip");
  check(summaryTip?.textContent.includes("已完成") && summaryTip.textContent.includes("预计用时：未设置") && !summaryTip.querySelector(".lubi-task-tip-notes"), "task tooltip: done state and missing estimate are explicit; empty notes take no space");
  view.tasksState.period = "week"; view.show("tasks", "2026-09-24"); await tick(); await tick();
  check(!document.body.querySelector(".lubi-tip"), "task tooltip: render clears stale summary");
}

// 清单拖拽排序：含计划时间的任务也可手动排序，不重排时间轴。
{
  const { blankTask } = await import("../.out/core.mjs");
  const D = "2030-02-03";
  for (const [i, start] of ["08:00", "10:00", "12:00"].entries()) {
    await plugin.tasks.upsert(blankTask({ id: `sort-${i}`, title: `排序任务${i}`, date: D, start, estimate: 15, order: i + 10 }));
  }
  view.tasksState.period = "week"; view.show("tasks", D); await tick(); await tick();
  const sortRows = () => [...root.querySelectorAll(".lubi-selected-day-list .lubi-task[data-task-id]")];
  const sortIds = () => sortRows().map(el => el.dataset.taskId);
  const fireSort = (target, type, data, y) => {
    const event = new window.MouseEvent(type, { bubbles: true, cancelable: true, clientY: y });
    Object.defineProperty(event, "dataTransfer", { value: data }); target.dispatchEvent(event); return event;
  };
  const data = taskTransfer();
  dispatchTaskDrop(sortRows()[2], "dragstart", data);
  const target = sortRows()[0]; target.getBoundingClientRect = () => ({ top: 100, height: 40 });
  const protectedData = { ...data, getData: () => "" };
  check(fireSort(target, "dragover", protectedData, 105).defaultPrevented && target.classList.contains("is-sort-before"), "sort: protected dragover uses local dragging row and shows upper insertion mark");
  const beforeSort = plugin.tasks.all.map(t => ({ ...t }));
  const recordsBeforeSort = JSON.stringify([...app.vault.files].filter(([path]) => path.startsWith("日记/")));
  const modalsBeforeSort = O.openModals.length;
  fireSort(target, "drop", data, 105);
  await new Promise(resolve => setTimeout(resolve, 220)); await tick();
  check(JSON.stringify(sortIds()) === JSON.stringify(["sort-2", "sort-0", "sort-1"]), "sort: drag last task before first persists visible manual order even with start times");
  check(plugin.tasks.all.every(t => JSON.stringify({ ...t, order: 0 }) === JSON.stringify({ ...beforeSort.find(old => old.id === t.id), order: 0 })), "sort: only order changes, schedule/status/notes/project remain unchanged");
  check(recordsBeforeSort === JSON.stringify([...app.vault.files].filter(([path]) => path.startsWith("日记/"))) && O.openModals.length === modalsBeforeSort, "sort: no completion, journal writes, or modals");
  await plugin.tasks.load(true); view.tasksState.period = "week"; view.show("tasks", D); await tick(); await tick();
  check(sortIds()[0] === "sort-2", "sort: saved order survives task store reload");
  const data2 = taskTransfer(); dispatchTaskDrop(sortRows()[0], "dragstart", data2);
  const bottom = sortRows()[2]; bottom.getBoundingClientRect = () => ({ top: 100, height: 40 });
  fireSort(bottom, "dragover", data2, 135);
  check(bottom.classList.contains("is-sort-after"), "sort: lower half shows after insertion mark");
  fireSort(bottom, "drop", data2, 135); await new Promise(resolve => setTimeout(resolve, 220)); await tick();
  check(JSON.stringify(sortIds()) === JSON.stringify(["sort-0", "sort-1", "sort-2"]), "sort: drag first task after last moves downward");
  const self = taskTransfer(); dispatchTaskDrop(sortRows()[0], "dragstart", self);
  fireSort(sortRows()[0], "drop", self, 0); await tick();
  dispatchTaskDrop(root.querySelector(".lubi-selected-day-list .lubi-panel-head"), "drop", self); await tick();
  check(plugin.tasks.byId("sort-0").start === "08:00" && sortIds()[0] === "sort-0", "sort: self-drop and card blank/header drop never clear scheduled start");
  sortRows()[1].dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowUp", altKey: true, bubbles: true, cancelable: true }));
  await new Promise(resolve => setTimeout(resolve, 220)); await tick();
  check(sortIds()[0] === "sort-1", "sort: Alt+ArrowUp supports keyboard reorder");
  const ordersBeforeFailure = plugin.tasks.all.map(t => [t.id, t.order]);
  const modifyBeforeFailure = app.vault.modify;
  app.vault.modify = async () => { throw new Error("排序写入失败夹具"); };
  try { await plugin.tasks.reorder(["sort-2", "sort-1", "sort-0"]); check(false, "sort: failed persistence should reject"); }
  catch { check(JSON.stringify(plugin.tasks.all.map(t => [t.id, t.order])) === JSON.stringify(ordersBeforeFailure), "sort: failed persistence restores in-memory order"); }
  finally { app.vault.modify = modifyBeforeFailure; }
  view.tasksState.period = "week"; view.show("tasks", "2026-09-24"); await tick(); await tick();
}

const assign = root.querySelector('button[data-lubi-tip^="安排 待安排事项 1 到"]');
check(!!assign, "unscheduled task has non-drag scheduling action");
assign.click(); await tick();
check(plugin.tasks.byId("inbox-0").date === "2026-09-24", "schedule action writes selected date");
await plugin.tasks.upsert({ ...plugin.tasks.byId("inbox-0"), notes: "安排后新增的备注" });
const taskUndo = [...document.body.querySelectorAll(".lubi-notice-btn")].at(-1);
check(!!taskUndo, "task reschedule shows undo action");
taskUndo.click(); await tick();
check(plugin.tasks.byId("inbox-0").date === "" && plugin.tasks.byId("inbox-0").notes === "安排后新增的备注", "task undo restores only schedule fields, preserving later notes");
view.tasksState.period = "week"; view.show("tasks", "2026-09-24"); await tick();
const chooseDate = root.querySelector('button[data-lubi-tip^="为 待安排事项 1 选择日期"]');
chooseDate.click(); await tick();
check(document.activeElement?.getAttribute("type") === "date", "choose-date action focuses accessible date input");
O.openModals.at(-1).close();
root.querySelector(".lubi-topbar-cta").click();
const keyboardTask = O.openModals.at(-1);
const taskTitle = keyboardTask.contentEl.querySelector('input[type="text"]');
keyboardTask.contentEl.querySelector(".lubi-repeat-select").dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
check(O.openModals.includes(keyboardTask), "Enter on repeat selector does not save task");
taskTitle.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
check(taskTitle.getAttribute("aria-invalid") === "true", "task title validation stays visible next to field");
taskTitle.value = "键盘新任务"; taskTitle.dispatchEvent(new window.Event("input", { bubbles: true }));
taskTitle.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
await tick();
check(!O.openModals.includes(keyboardTask) && plugin.tasks.all.some((t) => t.title === "键盘新任务" && t.date === "2026-09-24"), "Enter on valid task title saves task");
view.show("tasks", "2026-09-22"); await tick();
plugin.quickLog();
check(O.openModals.at(-1).constructor.name === "TaskModal" && O.openModals.at(-1).t.date === "2026-09-22", "N on the task page opens 待做 on the selected date");
O.openModals.at(-1).close();
view.show("today"); await tick();
check(view.date === "2026-09-22", "daily page follows the date picked on the task page");
view.setDate("2026-09-23"); view.show("tasks"); await tick();
check(view.tasksState.selectedDate === "2026-09-23" && root.querySelector(".lubi-date-label")?.textContent.includes("2026-09-23"), "task page follows the date picked on the daily page");
check(!root.querySelector(".lubi-error"), "no render errors after keyboard and schedule flows");

// 悬浮提示不重复：自有操作不保留原生提示属性，可访问名称仍然存在。
{
  const dupes = [];
  const scan = (where, host) => dupes.push(...[...host.querySelectorAll("[title], button[aria-label], [data-lubi-tip][aria-label], input[type=checkbox][aria-label]")].map((e) => `${where}:${e.tagName.toLowerCase()}.${e.className}`));
  for (const tab of ["today", "review", "tasks"]) { view.show(tab, "2026-09-24"); await tick(); await tick(); scan(tab, view.containerEl); }
  view.tasksState.period = "week"; view.show("tasks", "2026-09-24"); await tick(); scan("tasks+parent-groups", view.containerEl);
  openLegacyTime(); await tick(); scan("record-modal", O.openModals.at(-1).modalEl); O.openModals.at(-1).close();
  const anyTask = [...root.querySelectorAll(".lubi-task-title-button")][0];
  if (anyTask) { anyTask.click(); await tick(); scan("task-modal", O.openModals.at(-1).modalEl); O.openModals.at(-1).close(); }
  check(dupes.length === 0, `tooltip: no element uses a native title tooltip (${dupes.length}${dupes.length ? ": " + dupes.slice(0, 6).join(", ") : ""})`);
  check(root.querySelectorAll(".lubi-icon-btn[data-lubi-tip][aria-labelledby]").length > 0 && !root.querySelector(".lubi-icon-btn[aria-label]"), "tooltip: icon buttons use local hints and accessible names, not native black boxes");
}

// ---------- 每日页计划：拖动、双边调整、撤销 ----------
{
  const D = "2026-08-17", ID = "daily-plan-drag";
  const { blankTask } = await import("../.out/core.mjs");
  const settle = async () => { for (let i = 0; i < 8; i++) await tick(); };
  const planBlock = () => [...root.querySelectorAll(".lubi-plan")].find(el => el.querySelector(".lubi-plan-title")?.textContent === "计划拖动回归");
  const journalBefore = app.vault.files.get(`日记/${D}.md`);
  await plugin.tasks.upsert(blankTask({ id: ID, title: "计划拖动回归", category: "学习", date: D, start: "09:00", estimate: 60 }));
  view.show("today", D); await settle();
  let block = planBlock();
  check(!!block?.querySelector(".lubi-block-handle.is-top") && !!block?.querySelector(".lubi-block-handle.is-bottom"), "plan drag: both resize handles are available");
  const modalCount = O.openModals.length;
  await drag(block, 100, 100 + 60 * PXM);
  block.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 })); await tick();
  check(plugin.tasks.byId(ID).start === "10:00" && plugin.tasks.byId(ID).estimate === 60, "plan drag: moving changes start time but not duration");
  check(JSON.parse(app.vault.files.get("任务/任务数据.json")).tasks.find(t => t.id === ID).start === "10:00", "plan drag: schedule change is persisted");
  check(O.openModals.length === modalCount, "plan drag: releasing a moved plan does not open an actual-record form");
  for (const m of O.openModals.slice(modalCount)) m.close();
  block = planBlock();
  const bottom = block?.querySelector(".lubi-block-handle.is-bottom");
  if (bottom) {
    await drag(bottom, 100, 100 + 30 * PXM);
    check(plugin.tasks.byId(ID).start === "10:00" && plugin.tasks.byId(ID).estimate === 90, "plan drag: bottom edge changes estimated duration");
    await drag(planBlock().querySelector(".lubi-block-handle.is-top"), 100, 100 + 15 * PXM);
    check(plugin.tasks.byId(ID).start === "10:15" && plugin.tasks.byId(ID).estimate === 75, "plan drag: top edge changes start and keeps the end fixed");
    await plugin.tasks.upsert({ ...plugin.tasks.byId(ID), notes: "之后补充的备注" });
    [...document.body.querySelectorAll(".lubi-notice-btn")].at(-1).click(); await settle();
    check(plugin.tasks.byId(ID).start === "10:00" && plugin.tasks.byId(ID).estimate === 90 && plugin.tasks.byId(ID).notes === "之后补充的备注", "plan drag: undo restores only the changed schedule fields");
    const snapshot = JSON.stringify(plugin.tasks.byId(ID));
    await drag(planBlock(), 100, 100 + 60 * PXM, 0, 0, { cancel: true });
    check(JSON.stringify(plugin.tasks.byId(ID)) === snapshot, "plan drag: Escape cancels without saving");
    await drag(planBlock(), 100, 100 - 20 * 60 * PXM);
    check(plugin.tasks.byId(ID).start === "00:00", "plan drag: moving is clamped at midnight");
    await drag(planBlock(), 100, 100 + 25 * 60 * PXM);
    check(plugin.tasks.byId(ID).start === "22:30" && plugin.tasks.byId(ID).estimate === 90, "plan drag: moving cannot extend past 24:00");
    await drag(planBlock().querySelector(".lubi-block-handle.is-bottom"), 100, 100 + 60 * PXM);
    check(plugin.tasks.byId(ID).estimate === 90, "plan drag: resizing cannot extend past 24:00");
    await drag(planBlock().querySelector(".lubi-block-handle.is-bottom"), 100, 100 - 5 * 60 * PXM);
    check(plugin.tasks.byId(ID).estimate === 5, "plan drag: resizing preserves the minimum five-minute duration");
    await plugin.tasks.upsert({ ...plugin.tasks.byId(ID), date: D, start: "09:00", estimate: 60, startDate: D, repeat: { kind: "daily", days: [] }, doneDates: [], skipDates: [] });
    view.show("today", D); await settle();
    await drag(planBlock(), 100, 100 + 7 * PXM, 0, 0, { shiftKey: true });
    check(plugin.tasks.byId(ID).start === "09:07" && plugin.tasks.byId(ID).repeat.kind === "daily" && plugin.tasks.byId(ID).date === D && !plugin.tasks.byId(ID).doneDates.length, "plan drag: Shift gives minute precision and preserves repeat rules / completion state");
    await plugin.tasks.upsert({ ...plugin.tasks.byId(ID), repeat: { kind: "none", days: [] } });
    view.show("today", D); await settle();
    const beforeHandleClick = O.openModals.length;
    planBlock().querySelector(".lubi-block-handle.is-top").click();
    check(O.openModals.length === beforeHandleClick, "plan drag: clicking a resize handle does not create an actual record");
  }
  check(plugin.tasks.byId(ID).status === "todo" && app.vault.files.get(`日记/${D}.md`) === journalBefore, "plan drag: editing a plan neither completes it nor writes actual records");
  const normalClick = planBlock();
  pe(normalClick, "pointerdown", 100); pe(window, "pointerup", 100);
  normalClick.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 })); await tick();
  check(O.openModals.at(-1)?.constructor.name === "TaskModal" && O.openModals.at(-1).t.id === ID && O.openModals.at(-1).t.start === plugin.tasks.byId(ID).start, "plan drag: a normal click edits the latest plan after moving/resizing");
  O.openModals.at(-1)?.close();
  const cancelButton = planBlock()?.querySelector('.lubi-block-actions button[data-lubi-tip^="取消"]');
  pe(cancelButton, "pointerdown", 100); pe(window, "pointerup", 100); cancelButton.click(); await settle();
  check(plugin.tasks.byId(ID).date === "" && plugin.tasks.byId(ID).status === "todo" && app.vault.files.get(`日记/${D}.md`) === journalBefore, "plan drag: cancel-plan control remains independent of dragging");
  await plugin.tasks.remove(ID);
  for (const n of [...document.body.children]) if (n.querySelector?.(".lubi-notice-btn")) n.remove();
}

// 每日页两区：悬停、框选、取消、跨区拖动和按区默认表单。
{
  const D = "2026-08-14", ID = "region-plan-fixture";
  const { blankTask } = await import("../.out/core.mjs");
  const previousTab = view.tab, previousDate = view.date;
  const settle = async () => { for (let i = 0; i < 12; i++) await tick(); };
  await plugin.tasks.upsert(blankTask({ id: ID, title: "区域边界夹具", date: D, start: "09:00", estimate: 60, category: "学习" }));
  view.show("today", D); await settle();
  const setup = () => {
    const canvas = root.querySelector('.lubi-tl-canvas'), lane = canvas.querySelector('.lubi-plan-lane');
    canvas.getBoundingClientRect = () => ({left:0,right:400,top:0,bottom:1440*PXM,width:400,height:1440*PXM});
    if (lane) lane.getBoundingClientRect = () => ({left:280,right:400,top:0,bottom:1440*PXM,width:120,height:1440*PXM});
    return canvas;
  };
  let canvas = setup();
  const beforeFiles = JSON.stringify([...app.vault.files]);
  pe(canvas,'pointermove',12*60*PXM,100);
  check(canvas.querySelector('.lubi-tl-hover').dataset.area === 'record', 'regions: left hover stays in the record area');
  pe(canvas,'pointermove',12*60*PXM,330);
  check(canvas.querySelector('.lubi-tl-hover').dataset.area === 'plan' && canvas.querySelector('.lubi-tl-hover-label').textContent.includes('计划'), 'regions: right hover stays in the plan area and identifies planning');
  const beforeModals = O.openModals.length;
  pe(canvas,'pointerdown',12*60*PXM,330); pe(window,'pointermove',13*60*PXM,330);
  check(canvas.querySelector('.lubi-block-ghost.is-on')?.dataset.area === 'plan' && canvas.querySelector('.lubi-block-ghost.is-on')?.textContent.includes('计划'), 'regions: right drag paints a plan-only selection');
  pe(window,'pointerup',13*60*PXM,100); await tick();
  let modal = O.openModals.at(-1);
  check(O.openModals.length === beforeModals+1 && modal?.constructor.name === 'TaskModal' && modal.t.date === D && modal.t.start === '12:00' && modal.t.estimate === 60, 'regions: right-origin drag opens planning with selected date/start/duration even across the divider');
  modal.close(); await tick();
  check(JSON.stringify([...app.vault.files]) === beforeFiles && !canvas.querySelector('.lubi-block-ghost.is-on'), 'regions: cancelling planning leaves data unchanged and clears selection');
  pe(canvas,'pointerdown',14*60*PXM,100); pe(window,'pointermove',15*60*PXM,330);
  check(canvas.querySelector('.lubi-block-ghost.is-on')?.dataset.area === 'record', 'regions: left-origin selection does not switch area while crossing the divider');
  pe(window,'pointerup',15*60*PXM,330); await tick();
  modal = O.openModals.at(-1);
  check(modal?.constructor.name === 'TaskModal' && modal.actualDate === D && modal.actualStart === '14:00' && modal.actualText === '1h', 'regions: left-origin drag still opens an actual record');
  modal.close();
  const count = O.openModals.length;
  pe(canvas,'pointerdown',16*60*PXM,330); pe(window,'pointermove',17*60*PXM,330);
  window.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})); await tick();
  pe(canvas,'pointerdown',16*60*PXM,330); pe(window,'pointercancel',17*60*PXM,330); await tick();
  pe(canvas,'pointerdown',16*60*PXM,330); pe(window,'pointerup',16*60*PXM,330); await tick();
  check(O.openModals.length === count && !canvas.querySelector('.lubi-block-ghost.is-on') && JSON.stringify([...app.vault.files]) === beforeFiles, 'regions: Escape, pointer cancellation and simple clicks never create data or open forms');
  pe(canvas,'pointerdown',16*60*PXM,330); pe(window,'pointermove',15*60*PXM,330); pe(window,'pointerup',15*60*PXM,330); await tick();
  modal = O.openModals.at(-1);
  check(modal?.constructor.name === 'TaskModal' && modal.t.start === '15:00' && modal.t.estimate === 60, 'regions: upward selection creates the correct planning interval');
  modal.close();
  canvas.dispatchEvent(new window.MouseEvent('dblclick',{bubbles:true,clientX:330,clientY:17*60*PXM})); await tick();
  modal = O.openModals.at(-1);
  check(modal?.constructor.name === 'TaskModal' && modal.t.start === '17:00' && modal.t.date === D, 'regions: right-area double-click also defaults to planning');
  modal.close();
  await drag(canvas,18*60*PXM,18*60*PXM+45*PXM,330,330);
  modal = O.openModals.at(-1);
  const title = modal.contentEl.querySelector('input[placeholder="要做什么"]');
  title.value = '右侧选区新计划'; title.dispatchEvent(new window.Event('input',{bubbles:true}));
  modal.contentEl.querySelector('.lubi-modal-actions .mod-cta').click(); await settle();
  const created = plugin.tasks.all.find(task => task.title === '右侧选区新计划');
  check(created?.date === D && created.start === '18:00' && created.estimate === 45 && !plugin.tasks.isDoneOn(created,D) && !app.vault.files.get('日记/'+D+'.md'), 'regions: saving a right-area selection creates only an incomplete task, never an actual record');
  if (created) await plugin.tasks.remove(created.id);
  await plugin.tasks.remove(ID);
  view.show('today',D); await settle(); canvas = setup();
  check(!canvas.classList.contains('has-plans') && !canvas.querySelector('.lubi-plan-lane'), 'regions: no scheduled plans means no right planning lane');
  pe(canvas,'pointermove',8*60*PXM,390);
  check(canvas.querySelector('.lubi-tl-hover').dataset.area === 'record', 'regions: full-width hover remains record mode without a plan lane');
  await drag(canvas,8*60*PXM,9*60*PXM,390,390);
  modal = O.openModals.at(-1);
  check(modal?.constructor.name === 'TaskModal' && modal.actualStart === '08:00', 'regions: full-width blank selection remains recording without scheduled plans');
  modal.close();
  view.show(previousTab,previousDate); await settle();
}

// ---------- v1.5：计划层 + 待确认记录 ----------
{
  const D = "2026-09-26", ID = "plan-1";
  const settle = async () => { for (let i = 0; i < 5; i++) await tick(); };
  for (const n of [...document.body.children]) if (n.querySelector?.(".lubi-notice-btn")) n.remove();
  await plugin.tasks.upsert({ ...plugin.tasks.all[0], id: ID, title: "计划层测试", category: "学习", parent: null, status: "todo", blocked: false, date: D, start: "15:00", estimate: 60, repeat: { kind: "none", days: [] }, doneDates: [], doneLogs: undefined, startDate: "", endDate: "", origin: undefined });
  view.show("today", D); await settle();
  const plan = [...root.querySelectorAll(".lubi-plan")].find((x) => x.textContent.includes("计划层测试"));
  check(!!plan && !!root.querySelector(".lubi-tl-canvas.has-plans"), "plan: a timed task is drawn in the plan lane");
  const progressCard = root.querySelector(".lubi-plan-card");
  const progressBar = progressCard?.querySelector(".lubi-plan-progress");
  check(progressCard?.classList.contains("lubi-card") && progressCard.previousElementSibling?.classList.contains("lubi-distribution"), "plan: standalone card sits directly below distribution");
  const progressDoneBefore = Number(progressBar?.getAttribute("aria-valuenow"));
  const progressTotalBefore = Number(progressBar?.getAttribute("aria-valuemax"));
  check(progressTotalBefore >= 1 && progressDoneBefore < progressTotalBefore && progressBar.querySelector(".lubi-plan-progress-fill").style.width === `${Math.round(progressDoneBefore / progressTotalBefore * 100)}%`, "plan: progress uses the existing done/total count and includes the incomplete task");
  await checkInfoWithoutFooter(plan, "daily plan", ["计划层测试", "预计用时：", "待完成"]);
  check(plan.querySelectorAll(".lubi-block-actions button").length === 2 && !plan.querySelector(".lubi-plan-cancel") && plan.tagName !== "BUTTON", "timeline actions: plan uses two real buttons without a nested button or old cross");
  const countBeforeEdit = O.openModals.length;
  plan.querySelector('[data-icon="pencil"]').click(); await tick();
  check(O.openModals.length === countBeforeEdit + 1 && O.openModals.at(-1)?.constructor.name === "TaskModal" && O.openModals.at(-1)?.t.id === ID, "timeline actions: plan pencil edits the task without opening a recording form");
  O.openModals.at(-1)?.close();
  plan?.click(); await tick();
  const pm = O.openModals.at(-1);
  check(pm?.constructor.name === "TaskModal" && pm.t.id === ID && pm.t.date === D && pm.t.start === "15:00" && pm.t.estimate === 60, "plan: clicking a plan defaults to planning and edits the linked task");
  const journalBeforeEdit = app.vault.files.get(`日记/${D}.md`);
  pm?.close();
  for (const key of ["Enter", " "]) {
    plan.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); await tick();
    check(O.openModals.at(-1)?.constructor.name === "TaskModal" && O.openModals.at(-1)?.t.id === ID, `plan: keyboard ${key === " " ? "Space" : key} opens planning editor`);
    O.openModals.at(-1)?.close();
  }
  check(app.vault.files.get(`日记/${D}.md`) === journalBeforeEdit && !plugin.tasks.isDoneOn(plugin.tasks.byId(ID), D), "plan: clicking, keyboard opening and cancelling do not write records or complete tasks");
  plan.click(); await tick();
  const editor = O.openModals.at(-1); editor.t.estimate = 65;
  editor.contentEl.querySelector(".lubi-modal-actions .mod-cta").click(); await settle();
  check(plugin.tasks.byId(ID).estimate === 65 && !plugin.tasks.isDoneOn(plugin.tasks.byId(ID), D) && app.vault.files.get(`日记/${D}.md`) === journalBeforeEdit, "plan: saving a planning edit updates estimate only, without recording actual time");
  const taskRow = [...root.querySelectorAll(".lubi-plan-card .lubi-task")].find(row => row.querySelector(".lubi-task-title-text")?.textContent === "计划层测试");
  taskRow.querySelector(".lubi-task-start").click(); await tick();
  const recorder = O.openModals.at(-1);
  check(recorder?.constructor.name === "TaskModal" && recorder.t.id === ID && recorder.t.start === "15:00" && recorder.t.estimate === 65 && recorder.actualText === "", "plan: task Start still pre-fills a linked actual record with the latest plan");
  fillActual(recorder,65,"15:00");
  if (!recorder.contentEl.querySelector("[data-actual-action=complete]").disabled) recorder.contentEl.querySelector("[data-actual-action=complete]").click(); recorder.contentEl.querySelector("[data-actual-action=record]").click(); await settle();
  check(plugin.tasks.isDoneOn(plugin.tasks.byId(ID), D) && plugin.tasks.byId(ID).doneLogs?.[D]?.start === "15:00", "plan: saving the record completes the task");
  check(!(app.vault.files.get(`日记/${D}.md`) || "").includes("[待确认::"), "plan: a record confirmed in the form is not pending");
  view.show("today", D); await settle();
  check(![...root.querySelectorAll(".lubi-plan")].some((x) => x.textContent.includes("计划层测试")), "plan: a completed plan leaves the plan lane");
  // 待确认：虚线 + 徽标；点 ✓ 去掉标记
  await plugin.journal.add({ date: D, start: "17:00", minutes: 30, category: "学习", title: "待确认测试", extra: { 待确认: "按计划" } });
  view.show("today", D); await settle();
  const pb = [...root.querySelectorAll(".lubi-block.is-pending")].find((x) => x.textContent.includes("待确认测试"));
  check(!!pb?.querySelector(".lubi-pending-badge"), "pending: an estimated record is flagged on the timeline");
  check(Number(root.querySelector(".lubi-plan-progress")?.getAttribute("aria-valuenow")) === progressDoneBefore + 1 && Number(root.querySelector(".lubi-plan-progress")?.getAttribute("aria-valuemax")) === progressTotalBefore && root.querySelector(".lubi-plan-progress-fill")?.style.width === `${Math.round((progressDoneBefore + 1) / progressTotalBefore * 100)}%`, "plan: saving the record refreshes completion progress without changing pending record semantics");
  check(pb.querySelector("button.lubi-pending-badge") && pb.querySelectorAll(".lubi-block-actions button").length === 2, "timeline actions: pending record keeps confirmation on its badge and only two toolbar buttons");
  view.show("review", D); await settle();
  check(!!root.querySelector(".lubi-kpi-pending"), "pending: review KPI calls out estimated time");
  view.show("today", D); await settle();
  const pb2 = [...root.querySelectorAll(".lubi-block.is-pending")].find((x) => x.textContent.includes("待确认测试"));
  pb2?.querySelector('.lubi-pending-badge[data-lubi-tip="确认：时间与计划一致"]')?.click(); await settle();
  check(!(app.vault.files.get(`日记/${D}.md`) || "").includes("[待确认::"), "pending: ✓ confirms the record");
  // 主按钮文字随页面变化
  view.tasksState.period = "week"; view.show("tasks", D); await settle();
  check(root.querySelector(".lubi-topbar-cta")?.textContent.includes("新建任务"), "cta: task page button reads 新建任务");
  view.show("today", D); await settle();
  check(root.querySelector(".lubi-topbar-cta")?.textContent.includes("新建任务"), "cta: daily page uses the same unified task entry");
  check(!root.querySelector(".lubi-error"), "no render errors after plan / pending flows");
}

// ---------- ▶ 保存实际记录后完成任务；取消 / 写入失败不改变状态 ----------
{
  const D = "2026-08-03";
  const { blankTask, shiftDate } = await import("../.out/core.mjs");
  // 新日记的 create 事件会先经 120ms Vault 防抖，再经 150ms 视图防抖。
  const settle = async () => { for (let i = 0; i < 12; i++) await tick(); };
  const row = (title) => [...root.querySelectorAll(".lubi-task")].find((el) => el.querySelector(".lubi-task-title-text")?.textContent === title);
  const openStart = async (task) => {
    view.tasksState.period = "week"; view.show("tasks", D); await settle();
    row(task.title).querySelector(".lubi-task-start").click(); await tick();
    const modal = O.openModals.at(-1);
    check(modal?.constructor.name === "TaskModal" && modal.t.id === task.id && modal.actualText === "", "start: triangle opens actual time on the same task, without inventing duration");
    fillActual(modal,task.estimate||30,task.start||"09:00");
    return modal;
  };
  const linked = async (id) => (await plugin.journal.read(D)).filter((entry) => entry.rec.task === id);
  const make = async (id, repeat = { kind: "none", days: [] }) => {
    const task = blankTask({ id, title: `绿色开始测试 ${id}`, category: "学习", date: D, start: "10:00", estimate: 45, startDate: D, repeat });
    await plugin.tasks.upsert(task);
    return task;
  };
  const clean = async (id) => {
    let hit;
    while ((hit = (await linked(id))[0])) await plugin.journal.remove(D, hit.line);
    await plugin.tasks.remove(id);
  };
  const autoLog = plugin.settings.promptLogOnComplete;
  for (const repeating of [false, true]) {
    plugin.settings.promptLogOnComplete = !repeating;
    const task = await make(`start-save-${repeating}`, { kind: repeating ? "daily" : "none", days: [] });
    const previous = shiftDate(D, -1);
    if (repeating) { task.doneDates = [previous]; await plugin.tasks.upsert(task); }
    const modal = await openStart(task);
    check(!plugin.tasks.isDoneOn(plugin.tasks.byId(task.id), D), "start: opening the record does not complete the task");
    modal.t.title = "实际记录标题";
    if (!modal.contentEl.querySelector("[data-actual-action=complete]").disabled) modal.contentEl.querySelector("[data-actual-action=complete]").click(); modal.contentEl.querySelector("[data-actual-action=record]").click(); await settle();
    const current = plugin.tasks.byId(task.id);
    const records = await linked(task.id);
    check(records.length === 1 && records[0].rec.title === "实际记录标题", "start: saving writes exactly one actual record");
    check(plugin.tasks.isDoneOn(current, D), `start: saving completes the ${repeating ? "repeating" : "one-off"} task`);
    check(current.doneLogs?.[D]?.title === "实际记录标题" && current.doneLogs?.[D]?.start === "10:00", "start: completion registers the saved record, not the original draft");
    check(row(plugin.tasks.byId(task.id).title)?.querySelector('input[type="checkbox"]')?.checked && !!row(plugin.tasks.byId(task.id).title)?.querySelector(".lubi-task-start"), "start: completed rows still allow explicit actual recording");
    check(root.querySelector(".lubi-selected-day-list .lubi-panel-head .lubi-muted")?.textContent === "1/1 已做", "start: task completion count refreshes");
    const persisted = JSON.parse(app.vault.files.get("任务/任务数据.json")).tasks.find((item) => item.id === task.id);
    check(repeating ? persisted.doneDates.includes(D) : persisted.status === "done", "start: completed state is persisted to the task file");
    if (repeating) check(plugin.tasks.isDoneOn(current, D) && current.doneDates.includes(previous) && !plugin.tasks.isDoneOn(current, shiftDate(D, 1)), "start: a repeating task completes only this occurrence and preserves other days");
    if (plugin.tasks.isDoneOn(current, D)) {
      row(plugin.tasks.byId(task.id).title).querySelector('input[type="checkbox"]').click(); await settle();
      check(!plugin.tasks.isDoneOn(plugin.tasks.byId(task.id), D) && (await linked(task.id)).length === 1, "start: unchecking completion preserves the registered actual record");
    }
    await clean(task.id);
  }
  plugin.settings.promptLogOnComplete = autoLog;
  const alreadyDone = await make("start-already-done");
  await plugin.tasks.toggleDone(alreadyDone.id, D);
  const concurrentModal = await openStart(plugin.tasks.byId(alreadyDone.id));
  check(concurrentModal.contentEl.querySelector("[data-actual-action=complete]").disabled && plugin.tasks.isDoneOn(plugin.tasks.byId(alreadyDone.id), D), "record-only: already completed fixture opens with disabled completion, not a fresh opt-in");
  await plugin.tasks.toggleDone(alreadyDone.id, D);
  if (!concurrentModal.contentEl.querySelector("[data-actual-action=complete]").disabled) concurrentModal.contentEl.querySelector("[data-actual-action=complete]").click(); concurrentModal.contentEl.querySelector("[data-actual-action=record]").click(); await settle();
  check(!plugin.tasks.isDoneOn(plugin.tasks.byId(alreadyDone.id), D) && !!plugin.tasks.byId(alreadyDone.id).doneLogs?.[D] && (await linked(alreadyDone.id)).length === 1, "record-only: a concurrently reopened task keeps its latest status rather than stale auto completion");
  await clean(alreadyDone.id);
  const cancel = await make("start-cancel");
  (await openStart(cancel)).close(); await settle();
  check(!plugin.tasks.isDoneOn(plugin.tasks.byId(cancel.id), D) && (await linked(cancel.id)).length === 0, "start: cancelling leaves the task unfinished and writes no record");
  await clean(cancel.id);
  const failure = await make("start-failure");
  const failedModal = await openStart(failure);
  const originalAdd = plugin.journal.add;
  try {
    plugin.journal.add = async () => { throw new Error("Synthetic record write failure"); };
    if (!failedModal.contentEl.querySelector("[data-actual-action=complete]").disabled) failedModal.contentEl.querySelector("[data-actual-action=complete]").click(); failedModal.contentEl.querySelector("[data-actual-action=record]").click(); await settle();
    check(!plugin.tasks.isDoneOn(plugin.tasks.byId(failure.id), D) && (await linked(failure.id)).length === 0, "start: a failed record write leaves the task unfinished");
    check(O.openModals.includes(failedModal) && failedModal.contentEl.textContent.includes("无法保存"), "start: a failed write keeps the form open with an error");
  } finally { plugin.journal.add = originalAdd; failedModal.close(); }
  await clean(failure.id);
  check(!root.querySelector(".lubi-error"), "start: no render errors after save / cancel / failure flows");
}
// ---------- 预计用时快照与预计 / 实际 / 偏差展示 ----------
{
  const D = "2026-08-10";
  const { blankTask, shiftDate, PENDING_KEY } = await import("../.out/core.mjs");
  const settle = async () => { for (let i = 0; i < 12; i++) await tick(); };
  const taskRow = (title) => [...root.querySelectorAll(".lubi-task")].find(el => el.querySelector(".lubi-task-title-text")?.textContent === title);
  const linked = async (id, date = D) => (await plugin.journal.read(date)).filter(entry => entry.rec.task === id);
  const blockFor = (title) => [...root.querySelectorAll(".lubi-block")].find(el => el.querySelector(".lubi-block-title")?.textContent === title);
  const make = async (id, estimate, repeat = { kind: "none", days: [] }) => {
    const task = blankTask({ id, title: id, category: "学习", date: D, start: "09:00", estimate, startDate: D, repeat });
    await plugin.tasks.upsert(task);
    return task;
  };
  const openStart = async (task, date = D) => {
    view.show("tasks", date); await settle();
    taskRow(task.title).querySelector(".lubi-task-start").click(); await tick();
    return O.openModals.at(-1);
  };
  const save = async (modal) => { if(modal.constructor.name==="TaskModal"&&!modal.actualText.trim())fillActual(modal,modal.t.estimate||30,modal.t.start||"09:00"); if(modal.constructor.name==="TaskModal"){const choice=modal.contentEl.querySelector("[data-actual-action=complete]");if(!choice.disabled&&!choice.checked&&!choice.closest("[hidden]"))choice.click();}modal.contentEl.querySelector(modal.constructor.name === "TaskModal" ? "[data-actual-action=record]" : ".lubi-modal-actions .mod-cta").click(); await settle(); };
  const task = await make("estimate-snapshot", 45);
  let modal = await openStart(task);
  check(modal.t.estimate===45&&modal.actualText==='','estimate UI: task start keeps forecast separate and actual duration blank');
  fillActual(modal,60,'09:00');
  check(modal.contentEl.querySelector('.lubi-actual-hint')?.textContent==='预计 45min · 实际 1h · 超出 15min','estimate UI: actual input compares with the forecast without another dialog');
  await plugin.tasks.upsert({ ...plugin.tasks.byId(task.id), estimate: 90 });
  await save(modal);
  let saved = (await linked(task.id))[0];
  check(saved.rec.minutes === 60 && saved.rec.estimatedMinutes === 45 && plugin.tasks.isDoneOn(plugin.tasks.byId(task.id), D), "estimate UI: recording uses the captured forecast and still completes the task");
  check(app.vault.files.get(`日记/${D}.md`).includes("[时长:: 1h] [预计用时:: 45min]"), "estimate UI: Markdown stores actual duration and forecast as separate fields");
  view.show("today", D); await settle();
  let block = blockFor(task.title);
  check(!block.querySelector(".lubi-block-sub") && block.getAttribute("data-lubi-tip").includes("预计 45min · 实际 1h · 超出 15min"), "estimate UI: secondary comparison moves to details and still uses the historical snapshot");
  block.focus(); await tick();
  check(document.body.querySelector(".lubi-tip")?.textContent.includes("预计 45min · 实际 1h · 超出 15min"), "estimate UI: keyboard focus exposes the historical comparison");
  block.querySelector('[data-icon="pencil"]').click(); await tick();
  modal = O.openModals.at(-1);
  check(modal.rec.estimatedMinutes === 45, "estimate UI: editing a historical record preserves its forecast");
  const editedDuration = modal.contentEl.querySelector('.lubi-timebar-dur input[type="number"]');
  editedDuration.value = "1.25"; editedDuration.dispatchEvent(new window.Event("input", { bubbles: true }));
  await save(modal);
  saved = (await linked(task.id))[0];
  check(saved.rec.minutes === 75 && saved.rec.estimatedMinutes === 45, "estimate UI: editing actual time does not rewrite the forecast");
  view.show("today", D); await settle();
  check(!blockFor(task.title).querySelector('[data-lubi-tip="复制到明天"]') && blockFor(task.title).querySelectorAll(".lubi-block-actions button").length === 2, "timeline actions: record has only edit and delete, without copy-to-tomorrow");

  const noEstimate = await make("estimate-unset", 0);
  modal = await openStart(noEstimate);
  check(modal.t.estimate===0&&modal.actualText==="", "estimate UI: no forecast and no invented actual duration");
  fillActual(modal,30,"12:00");
  await plugin.tasks.upsert({ ...plugin.tasks.byId(noEstimate.id), estimate: 90 });
  await save(modal);
  check((await linked(noEstimate.id))[0].rec.estimatedMinutes === undefined, "estimate UI: tasks without forecasts save only actual duration");

  await plugin.journal.add({ date: D, start: "13:00", minutes: 30, category: "学习", title: "estimate-legacy-record", task: task.id, extra: {} });
  view.show("today", D); await settle();
  blockFor("estimate-legacy-record").querySelector('[data-icon="pencil"]').click(); await tick();
  modal = O.openModals.at(-1);
  check(modal.rec.estimatedMinutes === undefined && !modal.contentEl.querySelector(".lubi-estimate-values") && modal.contentEl.querySelector(".lubi-estimate-note")?.textContent.includes("没有预计用时快照"), "estimate UI: old linked records are not backfilled from current task estimates");
  await save(modal);
  check((await linked(task.id)).find(entry => entry.rec.title === "estimate-legacy-record").rec.estimatedMinutes === undefined, "estimate UI: saving an old record still does not invent a historical forecast");

  const auto = await make("estimate-auto-log", 30);
  view.tasksState.period = "week"; view.show("tasks", D); await settle();
  taskRow(auto.title).querySelector('input[type="checkbox"]').click(); await settle();
  check((await linked(auto.id)).length === 0, "estimate UI: completion alone never fabricates time");
  taskRow(auto.title).querySelector('.lubi-task-unlogged').click(); await settle();
  const pending = (await linked(auto.id))[0].rec;
  check(pending.estimatedMinutes === 30 && !!pending.extra[PENDING_KEY], "estimate UI: explicit planned backfill captures the forecast but remains pending");
  view.show("today", D); await settle();
  check(blockFor(auto.title).getAttribute("data-lubi-tip").includes("核对后再比较") && !blockFor(auto.title).getAttribute("data-lubi-tip").includes("实际 30min"), "estimate UI: timeline does not treat pending time as measured actual time");

  const repeat = await make("estimate-repeat", 45, { kind: "daily", days: [] });
  await save(await openStart(repeat));
  await plugin.tasks.upsert({ ...plugin.tasks.byId(repeat.id), estimate: 90 });
  await save(await openStart(plugin.tasks.byId(repeat.id), shiftDate(D, 1)));
  check((await linked(repeat.id))[0].rec.estimatedMinutes === 45 && (await linked(repeat.id, shiftDate(D, 1)))[0].rec.estimatedMinutes === 90, "estimate UI: repeated occurrences keep independent forecasts without changing history");
  check(!root.querySelector(".lubi-error"), "estimate UI: no render errors after snapshot / edit / copy / repeat flows");
}

// ---------- 时间轴边界刻度及当前时间标签 ----------
{
  const NativeDate = globalThis.Date;
  let clock = new NativeDate(2026, 8, 24, 0, 5).getTime();
  class FrozenDate extends NativeDate {
    constructor(...args) { if (args.length) super(...args); else super(clock); }
    static now() { return clock; }
  }
  const D = "2026-09-24";
  const settle = async () => { for (let i = 0; i < 3; i++) await tick(); };
  try {
    globalThis.Date = FrozenDate;
    for (const item of [
      { hour: 0, minute: 5, badge: "is-near-day-start" },
      { hour: 12, minute: 0, badge: "" },
      { hour: 23, minute: 55, badge: "is-near-day-end" },
    ]) {
      clock = new NativeDate(2026, 8, 24, item.hour, item.minute).getTime();
      view.show("today", D); await settle();
      const labels = [...root.querySelectorAll(".lubi-hour-label")];
      const nowLabel = root.querySelector(".lubi-now-label");
      const time = String(item.hour).padStart(2, "0") + ":" + String(item.minute).padStart(2, "0");
      check(labels[0]?.textContent === "00:00" && !labels[0].classList.contains("is-hidden") && labels[24]?.textContent === "24:00" && !labels[24].classList.contains("is-hidden"), "ruler: both boundary labels remain visible at " + time);
      check(item.badge ? nowLabel?.classList.contains(item.badge) && parseFloat(nowLabel.style.top) >= (item.badge === "is-near-day-start" ? parseFloat(root.querySelector(".lubi-timeline").style.getPropertyValue("--lubi-day-start-gutter")) + 24 : 0) : !!nowLabel && !nowLabel.classList.contains("is-near-day-start") && !nowLabel.classList.contains("is-near-day-end"), "ruler: current-time badge is clear at " + time);
    }
  } finally { globalThis.Date = NativeDate; view.show("today", D); await settle(); }
}

// 设置页：仅使用合成设置与离线接口，不读取真实插件 data.json 或访问外部服务。
{
  const SettingsTab = plugin.settingTabs[0].constructor;
  let writes = 0, migrations = 0, stored = null;
  const settingsPlugin = {
    manifest: { ...plugin.manifest },
    settings: JSON.parse(JSON.stringify(plugin.settings)),
    async saveSettings() { writes++; stored = JSON.parse(JSON.stringify(this.settings)); },
    async runMigration() { migrations++; },
  };
  settingsPlugin.settings.aiModel = "fixture-model";
  settingsPlugin.settings.aiEndpoint = "https://fixture.invalid/v1/chat/completions";
  settingsPlugin.settings.aiApiKey = "synthetic-key";
  const initial = JSON.stringify(settingsPlugin.settings);
  const tab = new SettingsTab(new O.App(), settingsPlugin);
  document.body.appendChild(tab.containerEl); tab.display(); await tick();
  const host = tab.containerEl;
  check(!host.querySelector(".lubi-settings-intro") && !host.textContent.includes("记录与任务保存在当前 Vault"), "settings: redundant introductory notice is not rendered");
  const ai = host.querySelector('.lubi-settings-ai');
  check(writes === 0 && JSON.stringify(settingsPlugin.settings) === initial, "settings: displaying and organizing settings does not save or mutate values");
  check([...host.querySelectorAll(':scope > .lubi-settings-section')].map(section => section.querySelector('h3, summary')?.textContent).join('|').includes('数据与日程|分类|JSON 任务导入|AI 任务创建fixture-model|支出类别|数据维护'), "settings: sections follow basics, categories, AI, expenses and maintenance");
  check(ai && !ai.open && host.querySelectorAll('[data-setting=ai-model]').length === 1 && ![...ai.querySelectorAll('select')].some(el => !el.closest('[data-setting=ai-keychain]')), "settings: AI is collapsed by default with one editable model control");
  const input = (el, value, type = 'input') => { el.value = value; el.dispatchEvent(new window.Event(type, { bubbles: true })); };
  const row = name => [...host.querySelectorAll('.setting-item')].find(el => el.querySelector('.setting-item-name')?.textContent === name);
  const button = text => [...host.querySelectorAll('button')].find(el => el.textContent === text);
  const legacyHours=[settingsPlugin.settings.scheduleStartHour,settingsPlugin.settings.scheduleEndHour];
  check(!host.querySelector('[data-setting=schedule-start],[data-setting=schedule-end]'), "settings: obsolete calendar clipping controls are removed without replacing them");
  input(row('日记文件夹').querySelector('input'), '测试日记');
  input(row('任务数据文件').querySelector('input'), '任务/测试任务.json');
  input(row('备份文件夹').querySelector('input'), '测试备份');
  check(JSON.stringify([stored.scheduleStartHour,stored.scheduleEndHour])===JSON.stringify(legacyHours), 'settings: unrelated saves preserve legacy numeric hour fields');
  input(row('每日可用小时').querySelector('input'), '100');
  check(!!row('完成与时间记录') && !row('完成任务时自动记一条'), 'settings: completion independence replaces the obsolete auto-record switch');
  check(stored.journalFolder === '测试日记' && stored.taskFile === '任务/测试任务.json' && stored.backupFolder === '测试备份' && stored.dailyCapacityHours === 24, "settings: paths and capacity clamp retain save behavior");
  check(host.querySelectorAll(".lubi-category-header").length === 1 && host.querySelector(".lubi-category-header").textContent === "名称图标颜色背景类型操作", "settings: category table displays a single concise header");
  let category = host.querySelector('.lubi-category-row');
  check([...category.querySelectorAll('.lubi-settings-field-label')].map(el => el.textContent).join('|') === '名称|图标|颜色|背景时间|类型', "settings: compact category row keeps accessible labels for every field");
  check([...category.querySelectorAll('input, select, [role=checkbox]')].every(el => document.getElementById(el.getAttribute('aria-labelledby'))?.textContent), "settings: category labels remain accessible to assistive technology");
  input(category.querySelector('[data-category-field=name] input'), '测试分类');
  input(category.querySelector('[data-category-field=kind] select'), 'money', 'change');
  input(category.querySelector('[data-category-field=icon] input'), 'wallet');
  input(category.querySelector('[data-category-field=color] select'), 'var(--color-green)', 'change');
  category.querySelector('[role=checkbox]').click(); await tick();
  check([".lubi-category-remove", ".lubi-category-up"].every(selector => { const action = category.querySelector(selector); return !action.hasAttribute("data-lubi-tip") && document.getElementById(action.getAttribute("aria-labelledby"))?.textContent.includes("测试分类"); }), "settings: renamed categories keep accessible action names without hover hints, redrawing or losing the input");
  check(stored.categories[0].name === '测试分类' && stored.categories[0].kind === 'money' && stored.categories[0].icon === 'wallet' && stored.categories[0].color === 'var(--color-green)' && !!stored.categories[0].rest, "settings: category name, kind, icon, color and background changes persist");
  const beforeOrder = settingsPlugin.settings.categories.map(c => c.name);
  host.querySelectorAll('.lubi-category-up')[1].click(); await tick();
  check(stored.categories[0].name === beforeOrder[1] && stored.categories[1].name === beforeOrder[0], "settings: category up control preserves ordering behavior");
  const count = settingsPlugin.settings.categories.length;
  host.querySelector('.lubi-category-remove').click(); await tick();
  button('添加分类').click(); await tick();
  check(stored.categories.length === count && stored.categories.at(-1).name === '新分类', "settings: category deletion and addition remain available");
  button('恢复默认').click(); await tick();
  check(stored.categories.length === 6 && stored.categories[0].name === '学习', "settings: category defaults can still be restored");
  input(row('类别列表').querySelector('textarea'), '餐饮，交通, 其他'); await tick();
  check(stored.expenseTypes.join('|') === '餐饮|交通|其他', "settings: expense types retain comma parsing");
  ai.open = true;
  const model = host.querySelector('[data-setting=ai-model]');
  const key = host.querySelector('[data-setting=ai-key]');
  check(key.type === 'password' && ai.textContent.includes('明文'), "settings: key remains masked and existing storage limitation is disclosed");
  input(model, 'fixture-model'); await tick();
  check(stored.aiModel === 'fixture-model' && host.querySelector('.lubi-settings-ai-model').textContent === 'fixture-model', "settings: typing a model saves it and updates the collapsed summary");
  const ownRequire = Object.hasOwn(globalThis, 'require'), oldRequire = globalThis.require;
  globalThis.require = () => { throw new Error('offline test transport'); };
  let requests = 0;
  try {
    O.setRequestUrlHandler(options => { requests++; return {status:200,json:{data:[{id:'fixture-model'},{id:'other-model'}]}}; });
    check(requests === 0, "settings: opening AI does not initiate network requests");
    button('获取模型列表').click(); await tick(); await tick();
    const choices = host.querySelector('.lubi-model-options');
    check(choices.querySelectorAll('[role=option]').length === 2 && model.value === 'fixture-model' && stored.aiModel === 'fixture-model', "settings: fetched suggestions use the same model input and preserve an available current model");
    input(model, 'other-model'); await tick();
    check(stored.aiModel === 'other-model', "settings: selecting a suggested model uses normal text change persistence");
    O.setRequestUrlHandler(() => { requests++; throw new Error('synthetic model failure'); });
    button('获取模型列表').click(); await tick(); await tick();
    check(model.value === 'other-model' && settingsPlugin.settings.aiModel === 'other-model' && O.notices.at(-1).includes('获取模型列表失败'), "settings: failed fetch preserves the current model and reports failure");
    O.setRequestUrlHandler(options => ({status:200,json:{data:[{id:'other-model'}]}}));
    button('测试连接').click(); await tick(); await tick();
    check(O.notices.at(-1).includes('AI 连接成功'), "settings: connection testing remains available through a mock interface");
    const connectionRoutes = [];
    O.setRequestUrlHandler(options => { connectionRoutes.push(options); return options.url.endsWith("/models") ? {status:404,json:{}} : {status:200,json:{}}; });
    button("测试连接").click(); await tick(); await tick();
    check(connectionRoutes.length === 2 && connectionRoutes[1].method === "POST" && JSON.parse(connectionRoutes[1].body).max_tokens === 1 && O.notices.at(-1).includes("不提供模型列表"), "settings: mock connection fallback still uses the existing short chat test");
  } finally { O.setRequestUrlHandler(null); if (ownRequire) globalThis.require = oldRequire; else delete globalThis.require; }
  const modalCount = O.openModals.length;
  button('检查并迁移').click(); await tick();
  check(migrations === 0 && O.openModals.length === modalCount + 1 && O.openModals.at(-1)?.constructor.name === 'ConfirmModal', "settings: migration still requires the existing confirmation before changing data");
  O.openModals.at(-1)?.close();
  button('显示').click(); await tick();
  check(stored.onboardingDone === false, "settings: compact onboarding reset remains available");
  host.remove();
}

// 统一悬停系统：三个自有界面、延迟、取消、原生遗漏、生命周期与隐私边界。
{
  const roots = ["lubi-root", "lubi-modal", "lubi-settings"].map(cls => {
    const host = document.createElement("div"); host.className = cls;
    host.innerHTML = '<button aria-label="独立操作提示">按钮</button><input aria-label="输入名称" value="草稿"><span title="旧原生提示">旧提示</span>';
    document.body.appendChild(host); return host;
  });
  const other = document.createElement("button"); other.setAttribute("aria-label", "其他插件提示"); other.setAttribute("title", "其他原生提示"); document.body.appendChild(other);
  await tick();
  check(roots.every(host => host.querySelector("button[data-lubi-tip][aria-labelledby]") && !host.querySelector("button[aria-label], [title]")), "unified tooltip: view, modal, and settings action labels are converted without native tooltip attributes");
  check(roots.every(host => document.getElementById(host.querySelector("input").getAttribute("aria-labelledby"))?.textContent === "输入名称" && !host.querySelector("input").hasAttribute("data-lubi-tip") && host.querySelector("input").value === "草稿"), "unified tooltip: input accessible names and draft values are preserved without adding hover hints");
  check(other.getAttribute("aria-label") === "其他插件提示" && other.getAttribute("title") === "其他原生提示", "unified tooltip: other plugins are outside scope");
  const action = roots[0].querySelector("button");
  action.getBoundingClientRect = () => ({ left: 1010, right: 1020, top: 750, bottom: 770, width: 10, height: 20 });
  action.dispatchEvent(new window.MouseEvent("pointermove", { bubbles: true, clientX: 1015, clientY: 750 }));
  check(!document.body.querySelector(".lubi-tip"), "unified tooltip: pointer hover is delayed");
  await new Promise(resolve => setTimeout(resolve, 280));
  let card = document.body.querySelector(".lubi-tip");
  check(card?.textContent === "独立操作提示" && card.getAttribute("role") === "tooltip" && document.body.querySelectorAll(".lubi-tip").length === 1, "unified tooltip: generic action uses a single local card");
  check(parseFloat(card.style.left) >= 8 && parseFloat(card.style.top) <= window.innerHeight - 8, "unified tooltip: near-edge placement stays in viewport");
  document.dispatchEvent(new window.Event("scroll"));
  check(!document.body.querySelector(".lubi-tip"), "unified tooltip: scrolling dismisses card");
  action.dispatchEvent(new window.MouseEvent("pointermove", { bubbles: true }));
  action.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 280));
  check(!document.body.querySelector(".lubi-tip"), "unified tooltip: Escape cancels a pending delayed tooltip");
  action.focus();
  check(document.body.querySelector(".lubi-tip")?.textContent === "独立操作提示", "unified tooltip: keyboard focus shows action hint without delay");
  action.dispatchEvent(new window.Event("dragstart", { bubbles: true }));
  check(!document.body.querySelector(".lubi-tip"), "unified tooltip: drag start dismisses card");
  action.blur();
  const svg = root.querySelector("svg circle[role=img]");
  if (svg) check(!svg.querySelector("title") && svg.hasAttribute("data-lubi-tip") && !!svg.querySelector("desc"), "unified tooltip: donut sectors have local hints and accessible SVG descriptions, no native title");
  action.dispatchEvent(new window.MouseEvent("pointermove", { bubbles: true }));
  plugin.onunload();
  await new Promise(resolve => setTimeout(resolve, 280));
  action.focus();
  check(!document.body.querySelector(".lubi-tip"), "unified tooltip: unload removes handlers and pending timer");
  roots.forEach(host => host.remove()); other.remove();
}

// 空 Vault 的入门提示沿用原来的关闭 / 重新显示状态，不增加第二个主按钮。
{
  await view.onClose();
  const emptyApp = new O.App();
  emptyApp.vault.files.set("任务/任务数据.json", JSON.stringify({ version: 14, tasks: [] }));
  const emptyPlugin = new LubiPlugin(emptyApp, { id: "lubi", version: "1.6.0" });
  await emptyPlugin.onload();
  for (const fn of emptyApp.workspace._ready) await fn();
  const emptyView = await emptyPlugin.activateView("today", "2026-10-04");
  await tick();
  const emptyRoot = emptyView.contentEl;
  check(!!emptyRoot.querySelector(".lubi-first-record") && !emptyRoot.querySelector(".lubi-onboard") && emptyRoot.querySelectorAll(".mod-cta").length === 1, "simplify: empty daily page has a one-line hint and a single primary CTA");
  emptyRoot.querySelector('.lubi-first-record button[data-lubi-tip="不再显示入门提示"]').click(); await tick();
  check(emptyPlugin.settings.onboardingDone && !emptyRoot.querySelector(".lubi-first-record"), "simplify: compact onboarding can still be dismissed");
  emptyPlugin.settings.onboardingDone = false;
  emptyView.show("today", "2026-10-04"); await tick();
  check(!!emptyRoot.querySelector(".lubi-first-record"), "simplify: existing onboarding reset restores the compact hint");
  check(JSON.parse(emptyApp.vault.files.get("任务/任务数据.json")).tasks.length === 0 && !emptyPlugin.journal.dates().length, "simplify: empty views never manufacture tasks or journal records");
  const emptyFiles=JSON.stringify([...emptyApp.vault.files]);
  emptyView.show("tasks","2026-10-04");await tick();await tick();
  check(!emptyRoot.querySelector(".lubi-tasks-projects, .lubi-project-toggle, .lubi-gantt") && !emptyRoot.textContent.includes("还没有项目") && JSON.stringify([...emptyApp.vault.files])===emptyFiles, "planning: empty vault has no project placeholder and no data writes");
  emptyView.show("today","2026-10-04");await tick();
  const { blankTask } = await import("../.out/core.mjs");
  const fixtureStarts = ["14:00", "08:00", "", "10:00", "09:00"];
  for (let i = 0; i < 5; i++) await emptyPlugin.tasks.upsert(blankTask({ id: `progress-${i}`, title: `进度夹具 ${i}`, date: "2026-10-04", start: fixtureStarts[i], status: i < 4 ? "done" : "todo" }));
  await emptyView.render();
  const planDropdown = emptyRoot.querySelector(".lubi-plan-task-details");
  const dropdownTitles = [...planDropdown.querySelectorAll(".lubi-task-title-text")].map(el => el.textContent);
  check(!!planDropdown && planDropdown.open && planDropdown.querySelectorAll(".lubi-task").length === 5 && planDropdown.querySelectorAll(".lubi-task.is-done").length === 4, "plan dropdown: includes all completed and incomplete tasks and is expanded by default");
  check(JSON.stringify(dropdownTitles) === JSON.stringify(["进度夹具 1", "进度夹具 4", "进度夹具 3", "进度夹具 0", "进度夹具 2"]), "plan dropdown: tasks are ordered by start time, with untimed last");
  check(emptyRoot.querySelector(".lubi-plan-progress")?.getAttribute("aria-valuenow") === "4" && emptyRoot.querySelector(".lubi-plan-progress")?.getAttribute("aria-valuemax") === "5" && emptyRoot.querySelector(".lubi-plan-progress-fill")?.style.width === "80%", "plan progress: four of five completed tasks render 80 percent");
  await emptyPlugin.tasks.upsert({ ...emptyPlugin.tasks.byId("progress-4"), status: "done" });
  await emptyView.render();
  check(emptyRoot.querySelector(".lubi-plan-progress-fill")?.style.width === "100%", "plan progress: all completed tasks render a full bar");
  check(emptyRoot.querySelector(".lubi-plan-task-details")?.open && emptyRoot.querySelectorAll(".lubi-plan-task-details .lubi-task.is-done").length === 5, "plan dropdown: refresh preserves expansion and lists every completed task");
  emptyView.show("today", "2026-10-05"); await tick();
  check(emptyRoot.querySelector(".lubi-plan-task-details")?.open && !emptyRoot.querySelector(".lubi-plan-task-list .lubi-task") && emptyRoot.querySelector(".lubi-plan-progress-fill")?.style.width === "0%", "plan dropdown: switching to an empty date retains zero progress without another day tasks");
  await emptyView.onClose(); emptyPlugin.onunload();
}

console.log("data file now:", app.vault.files.get("任务/任务数据.json").slice(0, 120).replace(/\n/g, " "));
// History names: production forms and persistence, synthetic isolated vault only.
{
  const { blankTask } = await import("../.out/core.mjs");
  const na = new O.App();
  const np = new LubiPlugin(na, {id:"lubi",version:"1.6.0"});
  await np.onload(); await np.tasks.load();
  const D = "2020-01-01";
  await np.journal.add({date:D,start:"09:00",minutes:15,category:"学习",title:"历史打游戏",extra:{}});
  for (let i = 0; i < 8; i++) await np.tasks.upsert(blankTask({id:`name-${i}`,title:i === 0 ? "历史打游戏" : `打游戏${i}`,category:"学习",created:`2026-01-0${i + 1}T00:00:00Z`,date:"2099-01-01"}));
  await np.tasks.upsert(blankTask({id:"name-exercise",title:"打篮球",category:"运动"}));
  await np.tasks.upsert(blankTask({id:"name-en",title:"Read Book",category:"学习",created:"2025-01-01T00:00:00Z"}));
  const initial = await np.nameCandidates("学习");
  check(initial.length === 9 && initial[0] === "打游戏7" && initial.filter(n => n === "历史打游戏").length === 1 && !initial.includes("打篮球"), "names: full history + tasks, dedup, recent first, same category");
  openLegacyTime(np,na); await tick();
  let modal = O.openModals.at(-1);
  const RecordForm = modal.constructor;
  const names = () => [...modal.contentEl.querySelectorAll(".lubi-name-option")].map(n => n.textContent);
  let input = modal.titleInput;
  input.focus(); input.click(); await tick();
  check(names().length === 9 && !modal.contentEl.querySelector(".lubi-name-options").hidden && input.getAttribute("aria-expanded") === "true", "names: time form opens full scrollable candidate list");
  const candidateList = modal.contentEl.querySelector(".lubi-name-options");
  check(!candidateList.hasAttribute("data-lubi-tip") && document.getElementById(candidateList.getAttribute("aria-labelledby"))?.textContent === "历史名称" && [...candidateList.children].every(el=>el.getAttribute("role")==="option"), "names: list keeps its accessible name without a redundant hover tooltip");
  const type = value => { input.value = value; input.dispatchEvent(new window.Event("input", {bubbles:true})); };
  type("游戏"); await tick();
  check(names().length === 8 && names().every(n => n.includes("游戏")), "names: substring query updates immediately");
  type("  read ");
  check(JSON.stringify(names()) === JSON.stringify(["Read Book"]), "names: case-insensitive query with trimmed whitespace");
  type("无匹配的新名称");
  check(modal.contentEl.querySelector(".lubi-name-options").hidden && modal.rec.title === "无匹配的新名称", "names: no match hides list and allows free text");
  type("打");
  const study = [...modal.contentEl.querySelectorAll(".lubi-cat-option")].find(b => b.dataset.cat === "运动");
  study.click(); await tick(); input.focus(); await tick();
  check(input.value === "打" && JSON.stringify(names()) === JSON.stringify(["打篮球"]), "names: switching category preserves query and switches candidate pool");
  const key = key => input.dispatchEvent(new window.KeyboardEvent("keydown", {key,bubbles:true,cancelable:true}));
  key("ArrowDown"); key("Enter");
  check(modal.rec.title === "打篮球" && O.openModals.includes(modal) && modal.contentEl.querySelector(".lubi-name-options").hidden, "names: keyboard selection fills only title, never submits form");
  input.click(); await tick(); key("Escape");
  check(O.openModals.includes(modal) && modal.contentEl.querySelector(".lubi-name-options").hidden, "names: Escape dismisses candidates without closing the form");
  const beforeCancel = JSON.stringify(np.settings.nameUses);
  modal.close();
  check(JSON.stringify(np.settings.nameUses) === beforeCancel, "names: selecting and cancelling never updates recency");
  modal = new RecordForm(na,np,{date:D,defaults:{start:"10:00",minutes:15,category:"学习",title:"历史打游戏"}}); modal.open(); await tick();
  await modal.save(); await tick();
  check((await np.nameCandidates("学习"))[0] === "历史打游戏" && np._data.nameUses.length === 1, "names: backdated successful record save updates persisted recency");
  const entry = (await np.journal.read(D)).find(r => r.rec.start === "10:00");
  modal = new RecordForm(na,np,{date:D,rec:entry.rec,line:entry.line}); modal.open(); await tick();
  const beforeEdit = JSON.stringify(np.settings.nameUses);
  modal.rec.minutes = 20; await modal.save(); await tick();
  check(JSON.stringify(np.settings.nameUses) === beforeEdit, "names: editing duration only does not update recency");
  modal = new RecordForm(na,np,{date:D,defaults:{start:"11:00",minutes:15,category:"学习",title:"未保存名称"}}); modal.open(); await tick();
  const add = np.journal.add.bind(np.journal); np.journal.add = async () => {throw Error("synthetic save failure")};
  await modal.save();
  check(JSON.stringify(np.settings.nameUses) === beforeEdit && O.openModals.includes(modal), "names: failed record save does not persist name usage");
  np.journal.add = add; modal.close();
  np.quickLog(); await tick(); modal = O.openModals.at(-1);
  modal = O.openModals.at(-1); const TaskForm = modal.constructor;
  input = modal.titleInput; type("打"); input.click(); await tick();
  check(names().length === 8 && input.getAttribute("role") === "combobox", "names: task form shares record candidates");
  const oldDate = modal.t.date, oldEstimate = modal.t.estimate;
  modal.contentEl.querySelector(".lubi-name-option").click();
  check(modal.t.title === "历史打游戏" && modal.t.date === oldDate && modal.t.estimate === oldEstimate, "names: task candidate fills title without copying old fields");
  await modal.save(); await tick();
  const newTask = np.tasks.all.find(t => t.title === "历史打游戏" && t.id !== "name-0" && t.origin !== "record");
  modal = new TaskForm(na,np,{task:newTask}); modal.open(); await tick();
  const taskRecency = JSON.stringify(np.settings.nameUses); modal.t.estimate += 5; await modal.save(); await tick();
  check(JSON.stringify(np.settings.nameUses) === taskRecency, "names: editing task estimate only does not update recency");
  modal = new TaskForm(na,np,{task:newTask}); modal.open(); await tick(); input=modal.titleInput; type("改名任务"); await modal.save(); await tick();
  check((await np.nameCandidates("学习"))[0] === "改名任务", "names: renamed task updates usage on successful save");
  // Metadata storage failure must not leave a successfully saved task open for duplicate submission.
  const saveData=np.saveData.bind(np); np.saveData=async()=>{throw Error("synthetic metadata failure")};
  modal=new TaskForm(na,np,{defaults:{title:"数据已保存",category:"学习"}});modal.open();await tick();await modal.save();await tick();
  check(!O.openModals.includes(modal) && np.tasks.all.filter(t=>t.title==="数据已保存").length===1 && O.notices.at(-1).includes("名称排序未能保存"), "names: metadata failure reports warning without duplicate content save");
  np.saveData=saveData; await np.saveSettings();
  const restarted=new LubiPlugin(na,{id:"lubi",version:"1.6.0"}); restarted._data=JSON.parse(JSON.stringify(np._data)); await restarted.onload();await restarted.tasks.load();
  check((await restarted.nameCandidates("学习"))[0] === "数据已保存", "names: restart preserves saved usage ordering");
  await np.journal.add({date:"2020-01-02",start:"09:00",minutes:15,category:"学习",title:"外部新记录",extra:{}});
  check((await np.nameCandidates("学习")).includes("外部新记录"), "names: journal change invalidates historical candidate cache");
  np.quickLog();await tick();modal=O.openModals.at(-1);
  [...modal.contentEl.querySelectorAll(".lubi-kind-seg .lubi-seg-item")].find(b=>b.textContent.includes("记录支出")).click();await tick();modal=O.openModals.at(-1);
  check(!modal.contentEl.querySelector(".lubi-name-combobox") && modal.titleInput.hasAttribute("list") && modal.contentEl.querySelector("datalist"), "names: expense form retains existing native suggestions, outside the new list");modal.close();
  restarted.onunload();np.onunload();
}

// Review Top 5: retain category/name aggregation, count and max-relative bar scaling.
{
  const ra=new O.App(); const rp=new LubiPlugin(ra,{id:"lubi",version:"1.6.0"});
  await rp.onload();await rp.tasks.load();
  const D="2026-09-21";
  for(let i=1;i<=7;i++) await rp.journal.add({date:D,start:`${String(i).padStart(2,"0")}:00`,minutes:i*10,category:i%2?"学习":"运动",title:`排行${i}`,extra:{}});
  await rp.journal.add({date:D,start:"12:00",minutes:100,category:"运动",title:"排行2",extra:{}});
  const rv=await rp.activateView("review",D);await tick();await tick();
  const top=rv.contentEl.querySelector(".lubi-review-top");const rows=[...top.querySelectorAll(".lubi-row-bar")];
  check(top.querySelector("h3").textContent==="事项 Top 5" && rows.length===5, "review Top5: title and maximum five items");
  check(JSON.stringify(rows.map(r=>r.querySelector(".lubi-legend-name").textContent))===JSON.stringify(["排行2","排行7","排行6","排行5","排行4"]), "review Top5: same totals sorted by duration, lower items excluded");
  check(rows[0].querySelector(".lubi-top-count").textContent==="2 次" && rows[0].querySelector(".lubi-legend-val").textContent==="2h", "review Top5: retain secondary count and duration");
  check(rows.every(r=>r.querySelector(".lubi-row-bar-head") && r.querySelector(".lubi-track > .lubi-fill")) && !top.querySelector(".lubi-legend-bar") && parseFloat(rows[0].querySelector(".lubi-fill").style.width)===100 && Math.abs(parseFloat(rows[1].querySelector(".lubi-fill").style.width)-70/120*100)<.01, "review Top5: shared category tracks with unchanged relative scaling");
  const breakdown=rv.contentEl.querySelector(".lubi-review-breakdown");
  const categoryRows=[...breakdown.querySelectorAll(".lubi-review-grid > .lubi-section:first-child .lubi-row-bar")];
  check(categoryRows.length===2&&JSON.stringify(Object.fromEntries(categoryRows.map(row=>[row.querySelector(".lubi-legend-name").textContent,row.querySelector(".lubi-legend-val").textContent])))===JSON.stringify({学习:"2.7h",运动:"3.7h"}), "review Top5: existing category totals remain unaffected");
  check(breakdown.querySelectorAll(".lubi-review-grid > .lubi-section").length===3&&breakdown.querySelector(".lubi-review-grid > .lubi-section:last-child").textContent.includes("暂无支出记录"), "review details: empty spending keeps its section without invented rows");
  // Fewer than five items are not padded with invented rows.
  rv.review.period="month";rv.review.anchor="2026-08-01";
  await rp.journal.add({date:"2026-08-01",start:"09:00",minutes:10,category:"学习",title:"唯一事项",extra:{}});
  rv.show("review","2026-08-01");await tick();await tick();
  check(rv.contentEl.querySelectorAll(".lubi-review-top .lubi-row-bar").length===1, "review Top5: fewer items show only available data");
  rp.onunload();rv.containerEl.remove();
}

// Planning hover follows the pointer, independent from creation/drop/drag snapping.
{
  const ha=new O.App(),hp=new LubiPlugin(ha,{id:"lubi",version:"1.6.0"});await hp.onload();await hp.tasks.load();
  const hv=await hp.activateView("tasks","2026-09-21");await tick();await tick();
  hv.tasksState.scheduleView="calendar"; // This suite exercises calendar hover explicitly, independent from the MONO default.
  const pe=(target,type,y,x=100)=>{const e=new window.MouseEvent(type,{bubbles:true,cancelable:true,clientY:y,clientX:x,button:0});Object.defineProperty(e,"pointerId",{value:9901});target.dispatchEvent(e);};
  for(const startH of [6,0]) {
    hp.settings.scheduleStartHour=startH;hv.tasksState.period="week";hv.show("tasks","2026-09-21");await tick();await tick();
    const cols=[...hv.contentEl.querySelectorAll(".lubi-week-col")],height=parseFloat(cols[0].style.height);
    for(const scale of [1,1.25,.8]) for(const origin of [100.25,-315.75]) for(const y of [.2,123.4,height-1.3]) {
      for(const col of cols)col.getBoundingClientRect=()=>({top:origin,height:height*scale,bottom:origin+height*scale,left:0,right:200,width:200});
      pe(cols[3],"pointermove",origin+y*scale);
      check(cols.every(col=>Math.abs(parseFloat(col.querySelector(".lubi-week-hover").style.top)-y)<.01) && Math.abs(parseFloat(hv.contentEl.querySelector(".lubi-week-hover-label").style.top)-y)<.01, `planning hover: exact crosshair offset ${y.toFixed(1)} with start ${startH}, scale ${scale}, origin ${origin}`);
    }
    pe(cols[3],"pointerleave",0);
    check(!hv.contentEl.querySelector(".lubi-week-hover.is-on")&&!hv.contentEl.querySelector(".lubi-week-hover-label.is-on"),"planning hover: leaving the column clears guides");
  }
  hp.settings.scheduleStartHour=6;hv.tasksState.period="week";hv.show("tasks","2026-09-21");await tick();await tick();
  const col=hv.contentEl.querySelector(".lubi-week-col"),height=parseFloat(col.style.height);col.getBoundingClientRect=()=>({top:100,height,bottom:100+height,left:0,right:200,width:200});
  // HTML task drop still rounds to the original 15-minute grid.
  const dropHover=new window.MouseEvent("dragover",{bubbles:true,cancelable:true,clientY:223.4});Object.defineProperty(dropHover,"dataTransfer",{value:{types:["text/lubi-task"]}});col.dispatchEvent(dropHover);
  check(parseFloat(col.querySelector(".lubi-week-hover").style.top)===126,"planning hover: dragged-task drop guide retains quarter-hour snapping");
  const before=JSON.stringify([...ha.vault.files]);
  pe(col,"pointerdown",223.4);pe(window,"pointermove",251.4);pe(window,"pointerup",251.4);await tick();
  const form=O.openModals.at(-1);
  check(form?.constructor.name==="TaskModal" && form.t.start==="02:00" && form.t.estimate===30,"planning hover: creating a task uses the full-day origin and retains quarter-hour snapping");form?.close();
  check(JSON.stringify([...ha.vault.files])===before,"planning hover: hover and cancelled creation write nothing");
  hp.onunload();hv.containerEl.remove();
}

// Gantt integration: actual minified bundle, memory-only fixtures, no real vault access.
{
  const {blankTask,ganttWindow}=await import("../.out/core.mjs");
  const ga=new O.App(),gp=new LubiPlugin(ga,{id:"lubi",version:"1.6.0"});await gp.onload();await gp.tasks.load();
  const D="2026-09-24",start="2026-09-23",end="2026-09-29";
  const make=(id,fields={})=>blankTask({id,title:id,category:"学习",created:"2026-09-01T00:00:00Z",...fields});
  for(const t of [make("g-parent",{startDate:start,endDate:end,date:"2026-09-25",start:"10:00",estimate:90,customField:{keep:true}}),make("g-child",{parent:"g-parent",date:"2026-09-25"}),make("g-done",{parent:"g-parent",date:"2026-09-26",status:"done"}),make("g-summary"),make("g-summary-child",{parent:"g-summary",startDate:"2026-09-27",endDate:"2026-10-04"}),make("g-single",{date:"2026-09-26",start:"09:00",estimate:70}),make("g-unplanned"),make("g-record",{date:"2026-09-26",origin:"record"}),make("g-repeat",{repeat:{kind:"daily",days:[]},startDate:"2026-09-22",endDate:"2026-09-28",skipDates:["2026-09-24"],doneDates:["2026-09-23"]})]) await gp.tasks.upsert(t);
  await gp.journal.add({date:D,start:"09:00",minutes:30,category:"学习",title:"真实记录不可被规划改写（合成夹具）",extra:{}});
  const gv=await gp.activateView("tasks",D),gr=gv.contentEl;
  const settle=async()=>{for(let i=0;i<8;i++)await tick()};await settle();
  const switchMode=async(mode)=>{[...gr.querySelectorAll(".lubi-schedule-switch button")].find(b=>b.dataset.lubiFocus===`schedule:${mode}`).click();await settle();if(mode==="gantt"){gr.querySelector('[data-lubi-focus="planning-period:month"]').click();await settle()}};
  const row=id=>gr.querySelector(`.lubi-gantt-row[data-task-id="${id}"]`),bar=id=>row(id)?.querySelector(".lubi-gantt-bar");
  const modelBefore=JSON.stringify(gp.tasks.all),vaultBefore=JSON.stringify([...ga.vault.files]);
  check(gv.tasksState.scheduleView==="list" && gv.tasksState.period==="day" && gr.querySelector(".lubi-planning-main .lubi-selected-day-list")&&!gr.querySelector(".lubi-gantt-card"),"gantt integration: defaults to approved MONO task-first list day without persisting another default");
  await switchMode("gantt");
  check(gr.querySelectorAll(".lubi-gantt-card").length===1 && !gr.querySelector(".lubi-week") && !gr.querySelector(".lubi-tasks-projects"),"gantt integration: alternate view occupies the same schedule region, not an added project panel");
  check(gr.querySelectorAll(".lubi-gantt-date").length===30 && gr.querySelector(".lubi-schedule-range").textContent==="9/1 – 9/30" && gr.querySelector(".lubi-topbar-left").textContent.includes("9/1"),"gantt integration: date header and shared context use the natural-month window");
  check(!!row("g-child")&&!!row("g-done")&&!row("g-unplanned")&&!row("g-record"),"gantt integration: hierarchy defaults expanded, completed plans stay, undated and actual-record tasks excluded");
  const repeatBars=[...row("g-repeat").querySelectorAll(".lubi-gantt-bar")];
  check(repeatBars.length===6&&!repeatBars.some(b=>b.dataset.from==="2026-09-24")&&repeatBars.find(b=>b.dataset.from==="2026-09-23").classList.contains("is-done")&&!row("g-repeat").querySelector(".is-editable, .lubi-gantt-handle"),"gantt integration: repeat segments/skips/done flags and read-only dates");
  check(bar("g-summary").classList.contains("is-summary")&&!bar("g-summary").classList.contains("is-editable")&&!row("g-summary").querySelector(".lubi-gantt-handle"),"gantt integration: derived parent summary is not a draggable explicit span");
  check(row("g-single").querySelectorAll(".lubi-gantt-handle").length===2,"gantt integration: single-day task offers both date boundaries");
  check(!row("g-single").querySelector(".lubi-gantt-spacer")&&!!row("g-child").querySelector(".lubi-gantt-spacer"),"gantt integration: flat task starts at left while children retain tree indentation");
  row("g-parent").querySelector(".lubi-gantt-collapse").click();await settle();
  check(!row("g-child")&&!row("g-done")&&row("g-summary-child"),"gantt integration: parent collapse hides only its descendants");
  row("g-parent").querySelector(".lubi-gantt-collapse").click();await settle();
  check(JSON.stringify(gp.tasks.all)===modelBefore&&JSON.stringify([...ga.vault.files])===vaultBefore,"gantt integration: view switching/collapse do not mutate data");
  const scroller=gr.querySelector(".lubi-gantt-scroll"),dateBeforeArrow=gv.tasksState.selectedDate;scroller.focus();
  const arrow=new window.KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true,cancelable:true});scroller.dispatchEvent(arrow);
  check(!arrow.defaultPrevented&&gv.tasksState.selectedDate===dateBeforeArrow,"gantt integration: keyboard scrolling is not intercepted by global date shortcuts");

  bar("g-parent").click();await tick();let form=O.openModals.at(-1);
  check(form?.constructor.name==="TaskModal"&&form.t.id==="g-parent","gantt integration: bar click edits the original task, no new modal type");form.close();
  bar("g-repeat").dispatchEvent(new window.KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}));await tick();form=O.openModals.at(-1);
  check(form?.constructor.name==="TaskModal"&&form.t.repeat.kind==="daily","gantt integration: repeat block remains editable by keyboard through the existing form");form.close();
  const pointer=(target,type,x,extra={})=>{const e=new window.MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:100,button:0,...extra});Object.defineProperty(e,"pointerId",{value:7701});target.dispatchEvent(e)};
  const setRect=target=>{const width=gr.querySelectorAll(".lubi-gantt-date").length*34;target.closest(".lubi-gantt-track").getBoundingClientRect=()=>({left:0,right:width,top:0,bottom:38,width,height:38})};
  const gesture=async(target,days,{cancel=false,pointerCancel=false}={})=>{setRect(target);pointer(target,"pointerdown",100);pointer(window,"pointermove",100+days*34);if(cancel)window.dispatchEvent(new window.KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}));else pointer(window,pointerCancel?"pointercancel":"pointerup",100+days*34);await settle()};
  const undo=async()=>{[...document.querySelectorAll(".lubi-notice-btn")].at(-1).click();await settle()};
  for(const n of [...document.body.children])if(n.querySelector?.(".lubi-notice-btn"))n.remove();
  const journalBefore=JSON.stringify([...ga.vault.files].filter(([p])=>p.startsWith("日记/")));
  const childBefore=JSON.stringify(gp.tasks.byId("g-child"));
  await gesture(bar("g-parent"),2);
  let t=gp.tasks.byId("g-parent");
  check(t.startDate==="2026-09-25"&&t.endDate==="2026-10-01"&&t.date==="2026-09-27"&&t.start==="10:00"&&t.estimate===90&&t.status==="todo"&&t.customField?.keep===true,"gantt integration: move shifts span and scheduled day together, not time/estimate/status");
  check(JSON.stringify(gp.tasks.byId("g-child"))===childBefore&&JSON.stringify([...ga.vault.files].filter(([p])=>p.startsWith("日记/")))===journalBefore,"gantt integration: parent move never shifts children or rewrites records");
  await gp.tasks.upsert({...t,title:"g-parent-renamed",notes:"concurrent note",estimate:91});await settle();await undo();t=gp.tasks.byId("g-parent");
  check(t.startDate===start&&t.endDate===end&&t.date==="2026-09-25"&&t.title==="g-parent-renamed"&&t.notes==="concurrent note"&&t.estimate===91,"gantt integration: undo restores date fields but retains other concurrent edits");
  await gesture(bar("g-parent").querySelector(".is-start"),10);
  check(gp.tasks.byId("g-parent").startDate==="2026-09-25"&&gp.tasks.byId("g-parent").endDate===end,"gantt integration: left resize stops at scheduled day");await undo();
  await gesture(bar("g-parent").querySelector(".is-end"),-10);
  check(gp.tasks.byId("g-parent").endDate==="2026-09-25"&&gp.tasks.byId("g-parent").startDate===start,"gantt integration: right resize cannot exclude scheduled day");await undo();
  const single=JSON.stringify(gp.tasks.byId("g-single"));await gesture(bar("g-single"),3);
  check(gp.tasks.byId("g-single").date==="2026-09-29"&&gp.tasks.byId("g-single").startDate===""&&gp.tasks.byId("g-single").endDate===""&&gp.tasks.byId("g-single").estimate===70,"gantt integration: single-day drag changes date only");await undo();
  for(const period of ["week","month"]) {
    gr.querySelector('[data-lubi-focus="planning-period:'+period+'"]').click();await settle();
    await gesture(bar("g-single").querySelector(".is-end"),2);
    check(gp.tasks.byId("g-single").startDate==="2026-09-26"&&gp.tasks.byId("g-single").endDate==="2026-09-28"&&gp.tasks.byId("g-single").date==="2026-09-26"&&gp.tasks.byId("g-single").estimate===70,period+" Gantt: end resize extends single-day plan without changing time/estimate");await undo();
    await gesture(bar("g-single").querySelector(".is-start"),-2);
    check(gp.tasks.byId("g-single").startDate==="2026-09-24"&&gp.tasks.byId("g-single").endDate==="2026-09-26",period+" Gantt: start resize extends single-day plan");await undo();
    check(JSON.stringify({...gp.tasks.byId("g-single"),updated:JSON.parse(single).updated})===single,period+" Gantt: undo restores original single-day task except modification timestamp");
    await gp.tasks.upsert({...gp.tasks.byId("g-single"),status:"done"});await settle();
    check(bar("g-single").classList.contains("is-done")&&row("g-single").classList.contains("is-done"),period+" Gantt: completing changes row and bar states");
    await gp.tasks.upsert({...gp.tasks.byId("g-single"),status:"todo"});await settle();
    check(!bar("g-single").classList.contains("is-done"),period+" Gantt: reopening restores bar state");
  }
  await gesture(bar("g-single").querySelector(".is-end"),2);
  await gp.tasks.upsert({...gp.tasks.byId("g-single"),endDate:"2026-09-29"});await settle();await undo();
  check(gp.tasks.byId("g-single").startDate==="2026-09-26"&&gp.tasks.byId("g-single").endDate==="2026-09-29","gantt integration: concurrent boundary edit prevents undo from creating an incomplete span");
  await gp.tasks.upsert({...gp.tasks.byId("g-single"),startDate:"",endDate:""});await settle();
  const beforeCancel=JSON.stringify(gp.tasks.all);await gesture(bar("g-parent"),3,{cancel:true});
  check(JSON.stringify(gp.tasks.all)===beforeCancel,"gantt integration: Escape cancels without writing");await gesture(bar("g-parent"),3,{pointerCancel:true});
  check(JSON.stringify(gp.tasks.all)===beforeCancel,"gantt integration: pointer cancellation writes nothing");
  const repeatSnapshot=JSON.stringify(gp.tasks.byId("g-repeat"));await gesture(bar("g-repeat"),3);
  check(JSON.stringify(gp.tasks.byId("g-repeat"))===repeatSnapshot&&!gr.querySelector(".lubi-gantt-bar.is-dragging"),"gantt integration: read-only repeat segments do not mutate rules through pointer gestures");
  // A failed task-file write restores the in-memory schedule too.
  const processFile=ga.vault.process.bind(ga.vault),beforeFailure=JSON.stringify(gp.tasks.byId("g-parent"));ga.vault.process=async(f,c)=>{if(f.path===gp.settings.taskFile)throw Error("synthetic task write failure");return processFile(f,c)};
  await gesture(bar("g-parent"),2);
  check(JSON.stringify(gp.tasks.byId("g-parent"))===beforeFailure&&O.notices.at(-1).includes("调整失败"),"gantt integration: failed write reports error and rolls back phantom in-memory dates");ga.vault.process=processFile;
  // Schedule changed during pointer gesture: do not overwrite it on release.
  const oldBar=bar("g-single");setRect(oldBar);pointer(oldBar,"pointerdown",100);pointer(window,"pointermove",168);
  gp.tasks.byId("g-single").date="2026-09-28";pointer(window,"pointerup",168);await settle();
  check(gp.tasks.byId("g-single").date==="2026-09-28"&&O.notices.at(-1).includes("本次拖动未保存"),"gantt integration: concurrent date change cancels stale gesture");
  // Undo must not create contradictory dates after a concurrent span edit.
  await gesture(bar("g-parent"),2);t=gp.tasks.byId("g-parent");await gp.tasks.upsert({...t,startDate:"2026-09-27"});await settle();const conflicting=JSON.stringify(gp.tasks.byId("g-parent"));await undo();
  check(JSON.stringify(gp.tasks.byId("g-parent"))===conflicting&&O.notices.at(-1).includes("日期冲突"),"gantt integration: undo refuses a conflicting partially changed span");
  const nav=gr.querySelector('[data-lubi-focus="planning:next"]');nav.click();await settle();
  check(gr.querySelector(".lubi-schedule-range").textContent==="10/1 – 10/31","gantt integration: existing forward navigation advances one natural month");
  gr.querySelector('[data-lubi-focus="planning:next"]').click();await settle();
  check(!!gr.querySelector(".lubi-gantt-empty")&&gr.querySelectorAll(".lubi-gantt-date").length===30&&!gr.querySelector(".lubi-gantt-row"),"gantt integration: empty future month keeps date headers without inventing tasks");
  gr.querySelector('[data-lubi-focus="planning:previous"]').click();await settle();
  gr.querySelector('[data-lubi-focus="planning:previous"]').click();await settle();
  const anchor=gr.querySelector(".lubi-schedule-range").textContent;gr.querySelector('.lubi-gantt-date[data-date="2026-09-28"]').click();await settle();
  check(gv.tasksState.selectedDate==="2026-09-28"&&gr.querySelector(".lubi-schedule-range").textContent===anchor,"gantt integration: selecting an in-window date does not unexpectedly recenter it");
  await switchMode("calendar");check(gr.querySelector(".lubi-month-calendar")&&!gr.querySelector(".lubi-gantt-card")&&gv.tasksState.selectedDate==="2026-09-28"&&gv.tasksState.period==="month","gantt integration: switching back preserves selected day and shared month range");
  const restarted=await gp.activateView("tasks",D); // Existing view retains its session; a fresh view returns to the approved list-day default.
  const newLeaf=ga.workspace.getLeaf();await newLeaf.setViewState({type:"lubi-dashboard",active:true});await settle();
  check(newLeaf.view.tasksState.scheduleView==="list" && newLeaf.view.tasksState.period==="day","gantt integration: a fresh view does not persist the last selected Gantt mode");
  check(JSON.stringify([...ga.vault.files].filter(([p])=>p.startsWith("日记/")))===journalBefore&&!gr.querySelector(".lubi-error"),"gantt integration: all planning gestures leave actual records untouched, with no render errors");
  gp.onunload();gv.containerEl.remove();newLeaf.view.containerEl.remove();
}

// Daily Gantt: today entry, 24-hour first row, horizontal time gestures and record preservation.
{
  const {blankTask,todayStr,shiftDate}=await import("../.out/core.mjs");const D=todayStr();
  const da=new O.App(),dp=new LubiPlugin(da,{id:"lubi",version:"1.6.0"});await dp.onload();await dp.tasks.load();
  for(const t of [blankTask({id:"dg-plan",title:"今日计划",date:D,start:"09:00",estimate:60,category:"学习"}),blankTask({id:"dg-unset",title:"未定时任务",date:D,estimate:30}),blankTask({id:"dg-point",title:"未填预计",date:D,start:"10:00",estimate:0}),blankTask({id:"dg-late",title:"跨午夜计划",date:D,start:"23:50",estimate:60}),blankTask({id:"dg-record",title:"实际记录不画计划",date:D,start:"08:00",estimate:30,origin:"record"}),blankTask({id:"dg-repeat",title:"每日重复",startDate:D,start:"07:00",estimate:30,repeat:{kind:"daily",days:[]},doneDates:[D]})])await dp.tasks.upsert(t);
  await dp.journal.add({date:D,start:"08:00",minutes:15,title:"保护实际记录（合成）",category:"学习",extra:{}});
  const dv=await dp.activateView("tasks",D);const root=dv.contentEl;const settle=async()=>{for(let i=0;i<8;i++)await tick()};await settle();
  const before=JSON.stringify([...da.vault.files]);
  [...root.querySelectorAll('.lubi-schedule-switch button')].find(b=>b.dataset.lubiFocus==="schedule:gantt").click();await settle();
  root.querySelector('[data-lubi-focus="planning-period:day"]').click();await settle();
  const row=id=>root.querySelector(`.lubi-daily-gantt-card .lubi-gantt-row[data-task-id="${id}"]`),bar=id=>row(id)?.querySelector('.lubi-gantt-bar');
  check(dv.tasksState.selectedDate===D&&dv.tasksState.scheduleView==="gantt"&&dv.tasksState.period==="day"&&root.querySelectorAll('.lubi-daily-gantt-card').length===1&&!root.querySelector('.lubi-week'),"daily Gantt: entry selects actual today in the existing schedule region");
  check(row("dg-repeat")?.classList.contains("is-done") && row("dg-repeat")?.querySelector(".lubi-gantt-title")?.textContent === "每日重复" && !row("dg-repeat").querySelector(".lubi-gantt-title")?.textContent.includes("✓") && !bar("dg-repeat")?.querySelector(".lubi-gantt-bar-label")?.textContent.includes("✓"),"daily Gantt: completed names use strikethrough class without checkmarks");
  const ticks=[...root.querySelectorAll('.lubi-daily-gantt-tick')];
  check(ticks.length===25&&ticks[0].textContent==="00:00"&&ticks.at(-1).textContent==="24:00"&&root.querySelector('.lubi-gantt-table').firstElementChild.classList.contains('lubi-gantt-heading'),"daily Gantt: first row is a complete 00:00–24:00 time axis");
  check(!!root.querySelector('.lubi-daily-unset-chip')&&root.querySelector('.lubi-daily-unset').textContent.includes('未定时')&&!row('dg-unset')&&!row('dg-record'),"daily Gantt: unset tasks do not fake 24-hour bars and actual records stay excluded");
  check(bar('dg-point').classList.contains('is-point')&&!row('dg-point').querySelector('.lubi-gantt-handle')&&bar('dg-point').dataset.minutes==='0',"daily Gantt: unset estimate is a start marker, not an invented duration");
  check(!row('dg-late').querySelector('.is-editable,.lubi-gantt-handle')&&bar('dg-late').dataset.minutes==='60'&&bar('dg-repeat').classList.contains('is-done')&&!bar('dg-repeat').classList.contains('is-editable'),"daily Gantt: clipped plans and repeat dates are not silently resized or changed");
  check(JSON.stringify([...da.vault.files])===before,"daily Gantt: opening the view never writes data");
  bar('dg-plan').click();await tick();let form=O.openModals.at(-1);check(form?.constructor.name==='TaskModal'&&form.t.id==='dg-plan',"daily Gantt: click edits the existing plan, not an actual record");form.close();
  const pe=(target,type,x,y=100)=>{const e=new window.MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0});Object.defineProperty(e,'pointerId',{value:882});target.dispatchEvent(e)};
  const dragTime=async(target,minutes,{cancel=false,shift=false,yDelta=0}={})=>{target.closest('.lubi-daily-gantt-plot').getBoundingClientRect=()=>({left:0,top:0,right:1440,bottom:38,width:1440,height:38});pe(target,'pointerdown',100);const move=new window.MouseEvent('pointermove',{bubbles:true,cancelable:true,clientX:100+minutes,clientY:100+yDelta,button:0,shiftKey:shift});Object.defineProperty(move,'pointerId',{value:882});window.dispatchEvent(move);if(cancel)window.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));else{const up=new window.MouseEvent('pointerup',{bubbles:true,cancelable:true,clientX:100+minutes,clientY:100+yDelta,button:0,shiftKey:shift});Object.defineProperty(up,'pointerId',{value:882});window.dispatchEvent(up)}await settle()};
  for(const n of [...document.body.children])if(n.querySelector?.('.lubi-notice-btn'))n.remove();
  const journalBefore=JSON.stringify([...da.vault.files].filter(([p])=>p.startsWith('日记/')));
  await dragTime(bar('dg-plan'),60,{yDelta:100});
  check(dp.tasks.byId('dg-plan').start==='10:00'&&dp.tasks.byId('dg-plan').estimate===60&&dp.tasks.byId('dg-plan').date===D,"daily Gantt: horizontal motion changes time only, vertical displacement does not corrupt it");
  const undo=async()=>{[...document.querySelectorAll('.lubi-notice-btn')].at(-1).click();await settle()};await undo();
  check(dp.tasks.byId('dg-plan').start==='09:00',"daily Gantt: undo restores original time");
  await dragTime(bar('dg-plan').querySelector('.is-end'),30);check(dp.tasks.byId('dg-plan').estimate===90,"daily Gantt: end handle changes planned minutes only");await undo();
  await dragTime(bar('dg-plan').querySelector('.is-start'),-30);check(dp.tasks.byId('dg-plan').start==='08:30'&&dp.tasks.byId('dg-plan').estimate===90,"daily Gantt: start handle keeps the original finish time");await undo();
  const snapshot=JSON.stringify(dp.tasks.all);await dragTime(bar('dg-plan'),50,{cancel:true});check(JSON.stringify(dp.tasks.all)===snapshot,"daily Gantt: Escape cancels without writing");
  await dragTime(bar('dg-point'),7,{shift:true});check(dp.tasks.byId('dg-point').start==='10:07'&&dp.tasks.byId('dg-point').estimate===0,"daily Gantt: Shift minute precision and empty estimate are preserved");await undo();
  root.querySelector('[data-lubi-focus="planning:next"]').click();await settle();check(dv.tasksState.selectedDate===shiftDate(D,1)&&root.querySelector('.lubi-schedule-range').textContent.includes(shiftDate(D,1)),"daily Gantt: shared navigation advances one day, not 28");
  root.querySelector('[data-lubi-focus="planning:today"]').click();await settle();check(dv.tasksState.selectedDate===D,"daily Gantt: Today returns to actual current date");
  check(JSON.stringify([...da.vault.files].filter(([p])=>p.startsWith('日记/')))===journalBefore&&!root.querySelector('.lubi-error'),"daily Gantt: planning edits never alter actual records or render errors");
  const filesBeforePeriods=JSON.stringify([...da.vault.files]);
  root.querySelector('[data-lubi-focus="planning-period:week"]').click();await settle();
  check(root.querySelectorAll('.lubi-gantt-date').length===7&&!root.querySelector('.lubi-daily-gantt-axis'),"unified Gantt: week period is available within the same entry");
  root.querySelector('[data-lubi-focus="planning-period:month"]').click();await settle();
  check(root.querySelectorAll('.lubi-gantt-date').length>=28&&root.querySelectorAll('.lubi-gantt-date').length<=31,"unified Gantt: month period uses actual month length");
  root.querySelector('[data-lubi-focus="planning-period:day"]').click();await settle();
  check(root.querySelectorAll('.lubi-daily-gantt-tick').length===25&&JSON.stringify([...da.vault.files])===filesBeforePeriods,"unified Gantt: period switching preserves daily timeline and writes no data");
  check([...root.querySelectorAll('.lubi-schedule-switch button')].map(b=>b.textContent).join('|')==='日历|甘特图|列表',"unified Gantt: one top-level Gantt entry, no duplicate Today Gantt entry");
  dp.onunload();dv.containerEl.remove();
}

console.log(fails ? `\n${fails} FAILED` : "\nSMOKE ALL PASSED");
process.exit(fails ? 1 : 0);
