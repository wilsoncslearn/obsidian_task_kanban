// All data in this suite lives in the mock memory Vault; no personal files or live services.
import assert from 'node:assert/strict';
import * as O from '../helpers/mock-obsidian.js';
import Module from 'node:module';
import { createRequire } from 'node:module';
const originalLoad = Module._load;
Module._load = function (name, ...args) { return name === 'obsidian' ? O : originalLoad.call(this, name, ...args); };
const Plugin = createRequire(import.meta.url)(process.env.LUBI_TEST_PLUGIN || '../.out/plugin.cjs').default;
const { blankTask, todayStr, shiftDate, backgroundRun, executorOf, dayTimeStats, PENDING_KEY, serializeRecord } = await import('../.out/core.mjs');
const app = new O.App(), plugin = new Plugin(app, { id: 'lubi', version: '1.7.1' });
await plugin.onload(); await plugin.tasks.load();
const D = todayStr(), previous = shiftDate(D, -1), next = shiftDate(D, 1);
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const settle = () => wait(240);
const categories = JSON.stringify(plugin.settings.categories);
plugin.settings.promptLogOnComplete = true; // A persisted legacy preference cannot reactivate old coupling.
const view = await plugin.activateView('today', D); await settle();
view.openNew(); await wait(25);
const Form = O.openModals.at(-1).constructor; O.openModals.at(-1).close();
const open = async options => { const form = new Form(app, plugin, { recordDate: D, ...options }); form.open(); await form.actualLoading; return form; };
const input = (form, selector, value, event = 'input') => { const field = form.contentEl.querySelector(selector); assert(field, selector); field.value = value; field.dispatchEvent(new window.Event(event, { bubbles: true })); };
const rows = async (id, date = D) => (await plugin.journal.read(date)).filter(row => row.rec.task === id);
const journalText = () => JSON.stringify([...app.vault.files].filter(([path]) => path.startsWith('日记/')));
const listRow = id => view.contentEl.querySelector(`.lubi-task[data-task-id="${id}"]`);
const queueRow = id => view.contentEl.querySelector(`.lubi-attention-card .lubi-execution-item[data-task-id="${id}"]`);

// Actor is a separate dimension; opening/cancelling does not mutate data or time classifications.
const beforeCancel = JSON.stringify([...app.vault.files]);
let form = await open({ defaults: { title: '取消后台设置' } });
[...form.contentEl.querySelectorAll('.lubi-ghost-btn')].find(button => button.textContent.includes('执行方式')).click();
input(form, '[data-task-executor]', 'background', 'change');
assert.equal(form.contentEl.querySelector('[data-task-executor]').value, 'background');
assert(form.contentEl.textContent.includes('不写入日记')); form.close();
assert.equal(JSON.stringify([...app.vault.files]), beforeCancel);
assert.equal(JSON.stringify(plugin.settings.categories), categories);
const project = await plugin.tasks.addProject('合成异步项目');
form = await open({ defaults: { id: 'agent-a', title: '后台结果 A', category: '日常', project: project.id } });
[...form.contentEl.querySelectorAll('.lubi-ghost-btn')].find(button => button.textContent.includes('执行方式')).click();
input(form, '[data-task-executor]', 'background', 'change'); await form.save();
assert.equal(executorOf(plugin.tasks.byId('agent-a')), 'background');
assert.equal(plugin.tasks.byId('agent-a').date, ''); assert.equal(plugin.tasks.byId('agent-a').estimate, 0);
assert.equal(journalText(), '[]');
await plugin.tasks.upsert(blankTask({ id: 'agent-b', title: '后台结果 B', category: '学习', executor: 'background', project: project.id, custom: { preserve: true } }));
await plugin.tasks.setBackgroundPhase('agent-a', D, 'running');
await plugin.tasks.setBackgroundPhase('agent-b', D, 'running');
const started = plugin.tasks.byId('agent-a').backgroundRuns.once.startedAt;
await plugin.tasks.setBackgroundPhase('agent-a', D, 'running');
assert.equal(plugin.tasks.byId('agent-a').backgroundRuns.once.startedAt, started, 'double-start cannot reset the clock');
assert.equal(journalText(), '[]');
assert.equal(plugin.tasks.byId('agent-a').date, '');
await plugin.tasks.setBackgroundPhase('agent-a', D, 'review');
await plugin.tasks.setBackgroundPhase('agent-b', D, 'review');
assert(!plugin.tasks.isDoneOn(plugin.tasks.byId('agent-a'), D));
assert.equal(journalText(), '[]', 'delivery is not acceptance or human work');
view.tasksState.scheduleView = 'list'; view.show('tasks', shiftDate(D, -40)); await settle();
assert.equal(view.contentEl.querySelectorAll('.lubi-attention-card .lubi-execution-item').length, 2, 'review queue is date-independent');

// A review record does not silently accept the result.
queueRow('agent-a').querySelector('[data-review-action="record"]').click(); await wait(30);
form = O.openModals.at(-1); await form.actualLoading;
input(form, '[data-actual=minutes]', '5'); input(form, '[data-actual=start]', '10:00', 'change');
form.contentEl.querySelector('[data-actual-action="record"]').click(); await settle();
assert.equal((await rows('agent-a'))[0].rec.minutes, 5);
assert.equal(plugin.tasks.byId('agent-a').status, 'doing');
assert.equal(backgroundRun(plugin.tasks.byId('agent-a'), D).phase, 'review');
assert(queueRow('agent-a'));

// Follow-up is a separate unplanned task in the same project; cancellation keeps source data unchanged.
const beforeFollowup = JSON.stringify([...app.vault.files]);
queueRow('agent-a').querySelector('[data-review-action="followup"]').click(); await wait(30);
form = O.openModals.at(-1);
assert.equal(form.t.project, project.id); assert.equal(form.t.parent, null);
assert.equal(form.t.date, ''); assert.equal(form.t.start, ''); assert.equal(form.t.estimate, 0);
assert.equal(executorOf(form.t), 'self'); form.close();
assert.equal(JSON.stringify([...app.vault.files]), beforeFollowup);
queueRow('agent-a').querySelector('[data-review-action="followup"]').click(); await wait(25);
form = O.openModals.at(-1); input(form, 'input[type=text]', '合成后续发布动作'); await form.save();
const followup = plugin.tasks.all.find(task => task.title === '合成后续发布动作');
assert.equal(followup.project, project.id); assert.equal(followup.parent, null); assert.equal(followup.date, '');
await settle();
// Rework means ready, not an invented physical restart or continuing wall time.
queueRow('agent-a').querySelector('[data-review-action="rework"]').click(); await settle();
assert.equal(backgroundRun(plugin.tasks.byId('agent-a'), D).phase, 'ready');
assert(!queueRow('agent-a')); assert.equal((await rows('agent-a')).length, 1);
await plugin.tasks.setBackgroundPhase('agent-a', D, 'running'); await plugin.tasks.setBackgroundPhase('agent-a', D, 'review'); await settle();
const beforeAcceptance = journalText();
queueRow('agent-b').querySelector('[data-review-action="accept"]').click(); await settle();
assert.equal(plugin.tasks.byId('agent-b').status, 'done'); assert.equal(plugin.tasks.byId('agent-b').date, '', 'acceptance must not invent a planned date');
assert.equal(journalText(), beforeAcceptance);
await plugin.tasks.setDone('agent-b', D, true); assert.equal(journalText(), beforeAcceptance, 'stale acceptance is idempotent');
await plugin.tasks.setDone('agent-b', D, false); await settle();
assert(queueRow('agent-b')); assert.equal(plugin.tasks.byId('agent-b').custom.preserve, true);
assert.equal(journalText(), beforeAcceptance, 'reopening never deletes a real record');

// Completion and actual recording are independent, including old doneLogs and legacy preference=true.
const human = await plugin.tasks.upsert(blankTask({ id: 'human', title: '本人部分投入', category: '学习', date: D, start: '09:00', estimate: 45, custom: 'kept' }));
form = await open({ actualRequired: true, task: human }); input(form, '[data-actual=minutes]', '20'); input(form, '[data-actual=start]', '09:15', 'change'); await form.save();
assert.equal(plugin.tasks.byId('human').status, 'todo'); assert.equal((await rows('human')).length, 1);
assert.equal((await rows('human'))[0].rec.estimatedMinutes, 45);
view.show('today', D); await settle();
assert(view.contentEl.querySelector('.lubi-plan'), 'partial recording keeps an unfinished planned task visible');
const beforeMark = journalText(); listRow('human').querySelector('input[type=checkbox]').click(); await settle();
assert.equal(plugin.tasks.byId('human').status, 'done'); assert.equal(journalText(), beforeMark);
listRow('human').querySelector('input[type=checkbox]').click(); await settle();
assert.equal(plugin.tasks.byId('human').status, 'todo'); assert.equal(journalText(), beforeMark);
form = await open({ actualRequired: true, task: plugin.tasks.byId('human') }); await form.save(true);
assert.equal(plugin.tasks.byId('human').status, 'done'); assert.equal((await rows('human')).length, 1, 'complete-and-record updates one existing record');
assert.equal(plugin.tasks.byId('human').custom, 'kept');
await plugin.tasks.setDone('human', D, false);
assert.equal((await rows('human')).length, 1);

// Explicit backfill needs real planning inputs, is pending, does not complete, and can be undone independently.
await plugin.tasks.upsert(blankTask({ id: 'backfill', title: '显式补记', category: '日常', date: D, start: '11:00', estimate: 15 }));
view.show('today', D); await settle();
listRow('backfill').querySelector('.lubi-task-unlogged').click(); await settle();
assert.equal((await rows('backfill')).length, 1); assert.equal((await rows('backfill'))[0].rec.extra[PENDING_KEY], '按计划');
assert.equal(plugin.tasks.byId('backfill').status, 'todo');
[...document.body.querySelectorAll('.lubi-notice-btn')].at(-1).click(); await settle();
assert.equal((await rows('backfill')).length, 0); assert.equal(plugin.tasks.byId('backfill').status, 'todo');
await plugin.tasks.upsert(blankTask({ id: 'no-estimate', title: '未估时任务', category: '日常', date: D })); await settle();
listRow('no-estimate').querySelector('input[type=checkbox]').click(); await settle();
assert.equal((await rows('no-estimate')).length, 0); assert(!listRow('no-estimate').querySelector('.lubi-task-unlogged'), 'no guessed 30 minutes or 09:00');

// Later human review completes only the intended repeat occurrence.
const repeat = await plugin.tasks.upsert(blankTask({ id: 'repeat-agent', title: '每天后台结果', category: '日常', executor: 'background', repeat: { kind: 'daily', days: [] }, startDate: '2020-01-01', created: '2020-01-01T00:00:00Z' }));
await plugin.tasks.setBackgroundPhase(repeat.id, previous, 'running'); await plugin.tasks.setBackgroundPhase(repeat.id, previous, 'review');
await plugin.tasks.setBackgroundPhase(repeat.id, next, 'running');
form = await open({ actualRequired: true, task: plugin.tasks.byId(repeat.id), completionDate: previous });
input(form, '[data-actual=minutes]', '10'); input(form, '[data-actual=start]', '12:00', 'change'); await form.save(true);
assert(plugin.tasks.byId(repeat.id).doneDates.includes(previous)); assert(!plugin.tasks.byId(repeat.id).doneDates.includes(D)); assert(!plugin.tasks.byId(repeat.id).doneDates.includes(next));
assert.equal(backgroundRun(plugin.tasks.byId(repeat.id), previous).phase, 'accepted'); assert.equal(backgroundRun(plugin.tasks.byId(repeat.id), next).phase, 'running');
assert.equal((await rows(repeat.id, D)).length, 1); assert.equal((await rows(repeat.id, previous)).length, 0);
await plugin.tasks.load(true); assert.equal(backgroundRun(plugin.tasks.byId(repeat.id), next).phase, 'running');

// Switching actor preserves metadata and freezes manual running time; no actual record is inferred.
const beforeSwitch = journalText();
await plugin.tasks.upsert({ ...plugin.tasks.byId(repeat.id), executor: 'self' });
assert.equal(backgroundRun(plugin.tasks.byId(repeat.id), next).phase, 'ready'); assert.equal(journalText(), beforeSwitch);
assert.equal(JSON.stringify(plugin.settings.categories), categories);

// Conflict and failure protection must not publish a phantom runtime state or overwrite outside edits.
const target = plugin.tasks.byId('agent-a'), originalPhase = JSON.stringify(target.backgroundRuns);
const processFile = app.vault.process.bind(app.vault);
app.vault.process = async (file, change) => { if (file.path === plugin.settings.taskFile) throw Error('合成写入失败'); return processFile(file, change); };
await assert.rejects(plugin.tasks.setBackgroundPhase(target.id, D, 'ready'), /写入失败/);
app.vault.process = processFile; assert.equal(JSON.stringify(plugin.tasks.byId(target.id).backgroundRuns), originalPhase);
const saved = JSON.parse(app.vault.files.get(plugin.settings.taskFile)); saved.customRoot = { preserve: true }; saved.tasks.find(task => task.id === target.id).notes = '外部修改必须保留';
const external = JSON.stringify(saved, null, 2); app.vault.files.set(plugin.settings.taskFile, external);
await assert.rejects(plugin.tasks.setBackgroundPhase(target.id, D, 'ready'), /外部更新/);
assert.equal(app.vault.files.get(plugin.settings.taskFile), external); assert.equal(JSON.stringify(plugin.tasks.byId(target.id).backgroundRuns), originalPhase);
await plugin.tasks.load(true); await plugin.tasks.setBackgroundPhase(target.id, D, 'ready');
assert.equal(JSON.parse(app.vault.files.get(plugin.settings.taskFile)).customRoot.preserve, true);
assert.equal(plugin.tasks.byId(target.id).notes, '外部修改必须保留');

// Runtime annotation is not personal time. All counted minutes come from explicit journal records.
const personal = (await plugin.journal.read(D)).map(row => row.rec);
const stats = dayTimeStats(personal);
assert.equal(stats.recordedMinutes, personal.reduce((sum, rec) => sum + rec.minutes, 0));
assert.equal(stats.recordedMinutes, 35);
assert.equal(JSON.parse(app.vault.files.get(plugin.settings.taskFile)).version, 14);
plugin.onunload(); await view.onClose(); view.containerEl.remove();
console.log('PASS async workflow: actor/cancel, date-independent review, no automatic Agent control, independent recording/completion/backfill, history preservation, unplanned acceptance, rework, flat follow-up, repeat isolation, failure/conflict protection and personal-time-only metrics');
