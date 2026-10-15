import assert from 'node:assert/strict';
import * as O from '../helpers/mock-obsidian.js';
import Module from 'node:module';
import {createRequire} from 'node:module';
import {blankTask,ganttWindow,shiftDate,shortDate,weekdayZh,todayStr} from '../.out/core.mjs';
const load=Module._load;Module._load=function(id,...args){return id==='obsidian'?O:load.call(this,id,...args)};
const Plugin=createRequire(import.meta.url)(process.env.LUBI_TEST_PLUGIN||'../.out/plugin.cjs').default;
const app=new O.App(), plugin=new Plugin(app,{id:'lubi',version:'1.6.0'});await plugin.onload();await plugin.tasks.load();
plugin.settings.onboardingDone=true;plugin.settings.promptLogOnComplete=false;
const D='2026-10-06';const settle=()=>new Promise(r=>setTimeout(r,230));
const task=(id,extra={})=>blankTask({id,title:id,category:'学习',...extra});
for(const t of [task('early',{date:D,start:'08:00',estimate:60}),task('late',{date:D,start:'14:00',estimate:30}),task('all-day',{date:D}),
 task('span',{startDate:'2026-10-04',endDate:'2026-10-09',date:'2026-10-07',start:'10:00',estimate:60}),
 task('repeat',{repeat:{kind:'daily',days:[]},startDate:'2026-10-05',endDate:'2026-10-11',doneDates:[D],skipDates:['2026-10-08']}),
 task('undated'),task('record',{date:D,origin:'record'}),task('parent'),task('child',{date:D,parent:'parent'})])await plugin.tasks.upsert(t);
await plugin.journal.add({date:D,start:'09:00',minutes:20,category:'学习',title:'synthetic actual',extra:{}});
await plugin.journal.add({date:D,start:'12:00',minutes:0,category:plugin.settings.categories.find(c=>c.kind==='money').name,title:'synthetic expense',amount:15,extra:{}});
const view=await plugin.activateView('tasks',D);await settle();const root=view.contentEl;
assert.equal(view.tasksState.scheduleView,'list');assert.equal(view.tasksState.period,'day');
assert.deepEqual([...root.querySelectorAll('.lubi-topbar-tabs button')].map(b=>b.textContent),['计划','回顾']);
assert.equal(view.tab,'tasks');
assert(root.querySelector('.lubi-planning-main .lubi-selected-day-list'),'MONO defaults to the approved task-first grouped day list');
const press=async key=>{const button=root.querySelector(`[data-lubi-focus="${key}"]`);assert(button,`missing control ${key}`);button.click();await settle()};
const journal=()=>JSON.stringify([...app.vault.files].filter(([name])=>name.startsWith('日记/')));
const dataBefore=JSON.stringify([...app.vault.files]);
for(const mode of ['calendar','gantt','list'])for(const period of ['day','week','month']) {
 await press(`schedule:${mode}`);await press(`planning-period:${period}`);
 assert.equal(view.tasksState.selectedDate,D);assert.equal(view.tasksState.period,period);
 assert.equal(root.querySelectorAll('.lubi-schedule-switch').length,1);
 assert.equal(root.querySelectorAll('.lubi-planning-period-switch').length,1);
 assert.equal(root.querySelectorAll('.lubi-topbar .mod-cta').length,1);
 const aiButton=root.querySelector('.lubi-topbar-ai');assert(aiButton&&aiButton.nextElementSibling===root.querySelector('.lubi-topbar-cta'));
 const beforeAi=JSON.stringify([...app.vault.files]);aiButton.click();await settle();const aiModal=O.openModals.at(-1);assert.equal(aiModal.constructor.name,'AiTaskModal');assert.equal(aiModal.date,D);aiModal.close();assert.equal(JSON.stringify([...app.vault.files]),beforeAi,'opening/canceling AI does not create tasks or records');
 assert(!root.querySelector('.lubi-error'));
 const sidebar=root.querySelector('.lubi-task-lists'),main=root.querySelector('.lubi-planning-main, .lubi-today-main');
 assert.equal(main.nextElementSibling,sidebar,'main content precedes the right sidebar in reading and keyboard order');
 if(mode==='calendar'&&period==='week') {
  const heads=[...root.querySelectorAll('.lubi-week-day-button')];assert.equal(heads.length,7);
  assert.equal(root.querySelector('.lubi-week-hour').textContent,'00:00');assert.equal([...root.querySelectorAll('.lubi-week-hour')].at(-1).textContent,'24:00');
  assert(root.querySelector('.lubi-wblock'));assert(root.querySelector('.lubi-allday-chip'));
 }
 if(mode==='calendar'&&period==='month') {
  assert.equal(root.querySelectorAll('.lubi-month-day').length,35);
  assert(root.querySelector('.lubi-month-task[data-task-id="early"]'));
  assert(!root.querySelector('.lubi-month-task[data-task-id="repeat"][data-date="2026-10-08"]'));
 }
 if(mode==='list') {
  assert(root.querySelector('.lubi-task-lists .lubi-inbox-card'));const selected=root.querySelector('.lubi-selected-day-list');assert(selected&&selected.dataset.date===D);assert(selected.querySelector('.lubi-quick-add'));assert.equal(root.querySelector('.lubi-inbox-card h3').textContent,'未安排');assert.equal(selected.parentElement,period==='day'?main:sidebar);assert(selected.querySelector('[data-task-id=early] input[type=checkbox]'));assert(selected.querySelector('[data-task-id=early] .lubi-task-start'));
  const rows=[...root.querySelectorAll('.lubi-planning-main .lubi-plan-range-list .lubi-task')];
  assert(rows.some(row=>row.dataset.taskId==='early'));assert.equal(rows.filter(row=>row.dataset.taskId==='span').length,1);
  const dayRows=rows.filter(row=>row.dataset.date===D);if(period!=='day')assert(dayRows.findIndex(row=>row.dataset.taskId==='early')<dayRows.findIndex(row=>row.dataset.taskId==='late'));
  if(period==='day'){const parentHeading=main.querySelector('[data-task-id=child]').closest('.lubi-task-group').querySelector('button.lubi-task-group-title');assert.equal(parentHeading?.querySelector(':scope > span')?.textContent,'parent','day grouping retains the editable original parent');}else assert.equal(main.querySelector('.lubi-plan-list-parent')?.textContent,'parent');
 }
 if(mode==='calendar'&&period==='day') {
  const side=root.querySelector('.lubi-task-lists');
  assert(side.previousElementSibling.classList.contains('lubi-today-main'),'day timeline precedes right sidebar in reading/tab order');
  assert.equal(side.querySelectorAll('.lubi-distribution').length,1);
  assert.equal(side.querySelectorAll('.lubi-plan-card').length,1);
  assert.equal(side.querySelectorAll('.lubi-inbox-card').length,1,'one inbox, no duplicate Today list');assert.equal(side.querySelectorAll('.lubi-selected-day-list').length,0);assert(side.querySelector('.lubi-background-card')&&side.querySelector('.lubi-personal-time'));
  assert(side.querySelector('.lubi-plan-task-details').open,'day plans expanded by default');
  assert.equal(side.querySelector('.lubi-donut-center').textContent,'0.3h','distribution uses actual, not planned duration');
  assert.equal(side.querySelector('.lubi-legend-pct').textContent,'100%');
  const tasks=[...side.querySelectorAll('.lubi-plan-task-list .lubi-task')];
  assert(tasks.findIndex(t=>t.dataset.taskId==='early')<tasks.findIndex(t=>t.dataset.taskId==='late'));
  assert(tasks.findIndex(t=>t.dataset.taskId==='late')<tasks.findIndex(t=>t.dataset.taskId==='all-day'),'untimed after timed');
  const progress=side.querySelector('[role="progressbar"]');
  assert.equal(Number(progress.getAttribute('aria-valuemax')),tasks.length);
  assert.equal(Number(progress.getAttribute('aria-valuenow')),1,'repeat completion is for selected occurrence');
  assert.deepEqual([...side.children].slice(0,5).map(e=>e.classList.contains('lubi-background-card')?'background':e.classList.contains('lubi-personal-time')?'time':e.classList.contains('lubi-distribution')?'distribution':e.classList.contains('lubi-plan-card')?'plans':'inbox'),['background','time','distribution','plans','inbox']);assert.equal(root.querySelector('.lubi-today-main').firstElementChild,root.querySelector('.lubi-attention-card'));
  const summary=root.querySelector('.lubi-today-summary'),head=root.querySelector('.lubi-planning-head');
  assert.equal(root.querySelectorAll('.lubi-today-summary').length,1);
  assert.equal(summary.parentElement,head);assert.equal(summary.previousElementSibling,head.querySelector('.lubi-schedule-range'));
  assert.equal(summary.nextElementSibling,head.querySelector('.lubi-nav'));
  assert(!root.querySelector('.lubi-calendar-day .lubi-today-summary'),'no duplicated standalone summary row');
  assert.deepEqual([...summary.querySelectorAll('.lubi-summary-label')].map(e=>e.textContent),['记录投入','实际覆盖']);
  assert.deepEqual([...summary.querySelectorAll('.lubi-summary-value')].map(e=>e.textContent),['0.3h','0.3h']);
  assert.equal(root.querySelector('.lubi-pin-title')?.textContent,'synthetic expense','spending remains on the daily rail');
  assert(root.querySelector('.lubi-block-title')?.textContent==='synthetic actual');
  assert.equal(root.querySelector('.lubi-hour-label').textContent,'00:00');
  assert.equal([...root.querySelectorAll('.lubi-hour-label')].at(-1).textContent,'24:00');
  assert(root.querySelector('.lubi-plan'));
  assert(root.querySelector('.lubi-gap-card'));
  assert(side.querySelector('[data-task-id=span]'),'spanning plans stay visible without inventing daily timed blocks');
  assert(![...root.querySelectorAll('.lubi-plan-title')].some(e=>e.textContent==='span'));
  assert(side.querySelector('[data-task-id=record]'),'actual-created task remains accessible in merged daily list');
 } else assert(!root.querySelector('.lubi-task-lists .lubi-distribution, .lubi-task-lists .lubi-plan-card'),'other presentations retain existing sidebar');
 assert(!root.querySelector('.lubi-planning-main [data-task-id="record"]'));
 assert(!root.querySelector('.lubi-task-lists > .lubi-list-card:last-child [data-task-id="span"]'),'spans do not enter the unscheduled inbox');
}
assert.equal(JSON.stringify([...app.vault.files]),dataBefore,'viewing all nine combinations never writes task or journal data');
// Shared distribution is identical to daily; refreshing preserves the chosen fold state.
await press('schedule:calendar');await press('planning-period:day');
const distribution=()=>root.querySelector('.lubi-distribution').innerHTML.replace(/lubi-tooltip-label-\d+/g,'lubi-tooltip-label');
const snapshot=distribution();
view.show('today',D);await settle();assert.equal(distribution(),snapshot);assert.equal(view.tab,'tasks');assert.equal(root.querySelectorAll('.lubi-calendar-day').length,1);
view.show('tasks',D);await settle();
root.querySelector('.lubi-plan-task-details').open=false;view.refresh();await settle();assert(!root.querySelector('.lubi-plan-task-details').open);
await press('planning:next');assert(root.querySelector('.lubi-plan-task-details').open);
assert.equal(root.querySelector('.lubi-donut-center').textContent,'0h','date navigation reloads summary');
view.show('tasks',D);await settle();
const beforeComplete=journal();
root.querySelector('.lubi-plan-task-list [data-task-id="early"] input').click();await settle();
assert.equal(root.querySelector('.lubi-plan-progress').getAttribute('aria-valuenow'),'2');
assert(root.querySelector('.lubi-plan-task-list [data-task-id="early"]').classList.contains('is-done'));
root.querySelector('.lubi-plan-task-list [data-task-id="early"] input').click();await settle();
assert.equal(root.querySelector('.lubi-plan-progress').getAttribute('aria-valuenow'),'1');
assert.equal(journal(),beforeComplete,'progress rendering does not create records with automatic logging disabled');
// Linked actual time does not implicitly complete its planned task.
await plugin.journal.add({date:D,start:'16:00',minutes:45,category:'学习',title:'linked actual',task:'late',extra:{}});
view.refresh();await settle();assert.equal(root.querySelector('.lubi-plan-progress').getAttribute('aria-valuenow'),'1');
assert.equal(root.querySelector('.lubi-donut-center').textContent,'1.1h');
// Shared summary read errors surface in the existing page error boundary.
const originalRead=plugin.journal.read;plugin.journal.read=async()=>{throw new Error('synthetic summary read failure')};
view.refresh();await settle();assert(root.querySelector('.lubi-error'));
plugin.journal.read=originalRead;view.refresh();await settle();assert(!root.querySelector('.lubi-error'));
// New day card keeps the existing inbox drop and quick-add paths.
await plugin.tasks.upsert(task('day-drop'));view.refresh();await settle();
const card=root.querySelector('.lubi-plan-card');
const event=new window.Event('drop',{bubbles:true,cancelable:true});
Object.defineProperty(event,'dataTransfer',{value:{types:['text/lubi-task'],getData:t=>t==='text/lubi-task'?'day-drop':'',dropEffect:''}});
card.dispatchEvent(event);await settle();
assert.equal(plugin.tasks.byId('day-drop').date,D);
assert(root.querySelector('.lubi-plan-task-list [data-task-id="day-drop"]').draggable);
assert(!root.querySelector('.lubi-list-card [data-task-id="day-drop"]'),'scheduled drop leaves inbox');
const input=root.querySelector('.lubi-quick-add input');input.value='day quick add';
input.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await settle();
assert(plugin.tasks.all.some(t=>t.title==='day quick add'&&t.date===D));
// Calendar-day timeline retains time-based inbox drop and undo; no actual record is invented.
await plugin.tasks.upsert(task('timeline-drop'));view.refresh();await settle();
const canvas=root.querySelector('.lubi-tl-canvas'), originalRect=canvas.getBoundingClientRect;
canvas.getBoundingClientRect=()=>({top:100,height:1440*1.25,left:100,width:500,right:600,bottom:1900});
const beforeTimelineDrop=journal();
const dropEvent=new window.MouseEvent('drop',{bubbles:true,cancelable:true,clientY:100+600*1.25});
Object.defineProperty(dropEvent,'dataTransfer',{value:{types:['text/lubi-task'],getData:t=>t==='text/lubi-task'?'timeline-drop':'',dropEffect:''}});
canvas.dispatchEvent(dropEvent);await settle();
assert.equal(plugin.tasks.byId('timeline-drop').date,D);assert.equal(plugin.tasks.byId('timeline-drop').start,'10:00');
assert.equal(journal(),beforeTimelineDrop);
[...document.querySelectorAll('.lubi-notice-btn')].at(-1).click();await settle();assert.equal(plugin.tasks.byId('timeline-drop').date,'');
// Legacy daily command routes into calendar-day even from another presentation, using today.
await press('schedule:gantt');await press('planning-period:month');
plugin.commands.find(c=>c.id==='open-today').callback();await settle();
assert.equal(view.tab,'tasks');assert.equal(view.tasksState.scheduleView,'calendar');assert.equal(view.tasksState.period,'day');
assert.equal(view.tasksState.selectedDate,(await import('../.out/core.mjs')).todayStr());
// Month-end navigation is shared by every presentation.
for(const mode of ['calendar','gantt','list']) {
 await press(`schedule:${mode}`);await press('planning-period:month');view.show('tasks','2026-01-31');await settle();
 await press('planning:next');assert.equal(view.tasksState.selectedDate,'2026-02-28');
 await press('planning:previous');assert.equal(view.tasksState.selectedDate,'2026-01-28');
}
view.show('tasks',D);await settle();await press('schedule:calendar');await press('planning-period:month');
const beforeDrag=journal();
const drop=async(selector,id,sourceDate='')=>{const target=root.querySelector(selector);assert(target,selector);const transfer={types:['text/lubi-task'],getData:type=>type==='text/lubi-task'?id:type==='text/lubi-task-date'?sourceDate:'',dropEffect:''};
 const e=new window.Event('drop',{bubbles:true,cancelable:true});Object.defineProperty(e,'dataTransfer',{value:transfer});target.dispatchEvent(e);await settle()};
await drop('.lubi-month-day[data-date="2026-10-09"]','early');assert.equal(plugin.tasks.byId('early').date,'2026-10-09');assert.equal(plugin.tasks.byId('early').start,'08:00');
await drop('.lubi-month-day[data-date="2026-10-09"]','span');assert.equal(plugin.tasks.byId('span').startDate,'2026-10-06');assert.equal(plugin.tasks.byId('span').endDate,'2026-10-11');
await drop('.lubi-month-day[data-date="2026-10-09"]','undated');assert.equal(plugin.tasks.byId('undated').date,'2026-10-09');
const repeatBefore=JSON.stringify(plugin.tasks.byId('repeat'));await drop('.lubi-month-day[data-date="2026-10-09"]','repeat');assert.equal(JSON.stringify(plugin.tasks.byId('repeat')),repeatBefore);
await drop('.lubi-month-day[data-date="2026-10-07"]','span','2026-10-06');
assert.equal(plugin.tasks.byId('span').startDate,'2026-10-07');assert.equal(plugin.tasks.byId('span').date,'2026-10-10');
const unchangedSpan=JSON.stringify(plugin.tasks.byId('span'));await drop('.lubi-month-day[data-date="2026-10-07"]','span','2026-10-07');assert.equal(JSON.stringify(plugin.tasks.byId('span')),unchangedSpan,'same continuation-day drop is a no-op');
await drop('.lubi-month-day[data-date="2026-11-01"]','early','2026-10-09');
assert.equal(view.tasksState.selectedDate,'2026-11-01');assert(root.querySelector('.lubi-month-task[data-task-id="early"][data-date="2026-11-01"]'),'adjacent-month drop navigates to its visible destination');
view.show('tasks',D);await settle();
assert.equal(journal(),beforeDrag,'calendar date moves never modify actual records');
// Month chips and date-Gantt segments must edit the clicked recurrence, not selectedDate.
const assertOccurrence=async(element,date)=>{assert(element);element.click();await settle();const edit=O.openModals.at(-1);assert(!edit.contentEl.querySelector('[data-actual]'),'light edit has no inline actual');edit.contentEl.querySelector('[data-light-record]').click();await settle();const modal=O.openModals.at(-1);assert.equal(modal.contentEl.querySelector('[data-actual="date"]').value,date);modal.close()};
await assertOccurrence(root.querySelector('.lubi-month-task[data-task-id="repeat"][data-date="2026-10-09"]'),'2026-10-09');
await press('schedule:gantt');await assertOccurrence(root.querySelector('.lubi-gantt-row[data-task-id="repeat"] .lubi-gantt-bar[data-from="2026-10-09"]'),'2026-10-09');
await press('schedule:list');const recurrence=root.querySelector('.lubi-plan-range-list .lubi-task[data-task-id="repeat"][data-date="2026-10-09"]');assert(recurrence);recurrence.querySelector('input').click();await settle();
assert(plugin.tasks.byId('repeat').doneDates.includes('2026-10-09'));assert(!plugin.tasks.byId('repeat').doneDates.includes('2026-10-10'));
// List selected-day sidebar reuses Gantt controls in all periods, not the range's first day.
const selectedNext=shiftDate(D,1);
await plugin.tasks.upsert(blankTask({id:'list-side-next',title:'所选次日任务',category:'学习',date:selectedNext,start:'10:00',estimate:25}));
const beforeSidebarRender=JSON.stringify([...app.vault.files]);
for(const period of ['day','week','month']) {
 view.tasksState.scheduleView='list';view.tasksState.period=period;view.show('tasks',selectedNext);await settle();
 const side=root.querySelector('.lubi-selected-day-list'),main=root.querySelector('.lubi-plan-range-list');
 assert(side&&side.dataset.date===selectedNext&&main);assert(side.querySelector('[data-task-id=list-side-next]'));assert(!side.querySelector('[data-task-id=early]'));
 assert(side.querySelector('.lubi-quick-add input').getAttribute('aria-label')?.includes(selectedNext)||document.getElementById(side.querySelector('.lubi-quick-add input').getAttribute('aria-labelledby'))?.textContent.includes(selectedNext));
 assert.equal(side.querySelector('h3').textContent,period==='day'?'当天任务':selectedNext===todayStr()?'今日计划':`${shortDate(selectedNext)} 周${weekdayZh(selectedNext)}`);
 assert.equal(root.querySelector('.lubi-inbox-card h3').textContent,'未安排');
}
assert.equal(JSON.stringify([...app.vault.files]),beforeSidebarRender,'switching list periods does not write task data');
let selectedCard=root.querySelector('.lubi-selected-day-list');selectedCard.querySelector('[data-task-id=list-side-next] .lubi-task-title-button').click();await settle();let selectedForm=O.openModals.at(-1);assert.equal(selectedForm.t.id,'list-side-next');selectedForm.close();
selectedCard.querySelector('[data-task-id=list-side-next] .lubi-task-start').click();await settle();selectedForm=O.openModals.at(-1);assert.equal(selectedForm.t.id,'list-side-next');assert.equal(selectedForm.actualDate,selectedNext);selectedForm.close();
selectedCard.querySelector('[data-task-id=list-side-next] input[type=checkbox]').click();await settle();assert(plugin.tasks.isDoneOn(plugin.tasks.byId('list-side-next'),selectedNext));assert(root.querySelector('.lubi-plan-range-list [data-task-id=list-side-next] input').checked);assert(root.querySelector('.lubi-selected-day-list [data-task-id=list-side-next] input').checked);
root.querySelector('.lubi-selected-day-list [data-task-id=list-side-next] input[type=checkbox]').click();await settle();assert(!plugin.tasks.isDoneOn(plugin.tasks.byId('list-side-next'),selectedNext));
selectedCard=root.querySelector('.lubi-selected-day-list');const quick=selectedCard.querySelector('.lubi-quick-add input');quick.value='侧栏新建所选日任务';selectedCard.querySelector('.lubi-quick-add button').click();await settle();const created=plugin.tasks.all.find(t=>t.title==='侧栏新建所选日任务');assert(created&&created.date===selectedNext);assert(root.querySelector(`.lubi-plan-range-list [data-task-id="${created.id}"]`));
view.show('tasks',D);await settle();assert.equal(root.querySelector('.lubi-selected-day-list').dataset.date,D);
console.log('PASS list sidebar: all periods, selected date (not range start), shared actions, no render writes, completion sync and quick add');
// Session remembers view and range across page switches; new instance resets without writing settings.
view.show('review');await settle();view.show('tasks');await settle();assert.equal(view.tasksState.scheduleView,'list');assert.equal(view.tasksState.period,'month');
const fresh=app.workspace.getLeaf(true);await fresh.setViewState({type:'lubi-dashboard',active:true});await settle();assert.equal(fresh.view.tasksState.scheduleView,'list');assert.equal(fresh.view.tasksState.period,'day');
// An empty Vault still renders all three presentation axes, plus one range switch.
const emptyApp=new O.App(),emptyPlugin=new Plugin(emptyApp,{id:'lubi',version:'1.6.0'});await emptyPlugin.onload();await emptyPlugin.tasks.load();const emptyView=await emptyPlugin.activateView('tasks',D);await settle();
for(const mode of ['calendar','gantt','list'])for(const period of ['day','week','month']) {
 const state=emptyView.tasksState;state.scheduleView=mode;state.period=period;emptyView.show('tasks',D);await settle();const host=emptyView.contentEl;
 assert(host.querySelector('.lubi-planning-period-switch'));assert(!host.querySelector('.lubi-error'));
 assert(host.querySelector(mode==='calendar'?(period==='month'?'.lubi-month-calendar':period==='day'?'.lubi-timeline':'.lubi-week'):mode==='gantt'?'.lubi-gantt-heading':period==='day'?'.lubi-planning-main .lubi-selected-day-list':'.lubi-plan-list-date'));
 if(mode==='calendar'&&period==='day') {
  assert(host.querySelector('.lubi-distribution svg circle'),'empty ring retained');
  assert.equal(host.querySelector('.lubi-donut-center').textContent,'0h');
  assert(host.querySelector('.lubi-distribution').textContent.includes('暂无记录'));
  assert(host.querySelector('.lubi-plan-card').textContent.includes('0/0 已做'));
  assert.equal(host.querySelector('.lubi-plan-progress-fill').style.width,'0%');
  assert(host.querySelector('.lubi-plan-task-details').open);
  assert(host.querySelector('.lubi-plan-task-details').textContent.includes('暂无安排'));
 }
}
// Flat daily actions: date-only ancestors are context, never progress or duplicated rows.
await emptyPlugin.tasks.upsert(blankTask({id:'flat-root',title:'考研数学',category:'学习',date:D}));
await emptyPlugin.tasks.upsert(blankTask({id:'flat-mid',title:'微积分',category:'学习',parent:'flat-root',date:D}));
await emptyPlugin.tasks.upsert(blankTask({id:'flat-first',title:'导数学习',category:'学习',parent:'flat-mid',date:D,start:'08:00',estimate:30}));
await emptyPlugin.tasks.upsert(blankTask({id:'flat-second',title:'积分学习',category:'学习',parent:'flat-mid',date:D,start:'09:00',estimate:45}));
const beforeFlat=JSON.stringify([...emptyApp.vault.files]);emptyView.show('today',D);await settle();let flat=emptyView.contentEl.querySelector('.lubi-plan-task-list');
assert.equal(JSON.stringify([...emptyApp.vault.files]),beforeFlat,'rendering does not modify tasks or completion');
assert.equal(flat.querySelectorAll('.lubi-task').length,2);assert.equal(flat.querySelectorAll('.lubi-task-group-title').length,1);
assert(!flat.querySelector('[data-task-id="flat-root"]'));assert(!flat.querySelector('[data-task-id="flat-mid"]'));
assert.deepEqual([...flat.querySelectorAll('.lubi-task')].map(e=>e.dataset.taskId),['flat-first','flat-second']);
assert.equal(flat.querySelector('.lubi-task-group-title span').textContent.trim(),'考研数学 / 微积分');assert([...flat.querySelectorAll('.lubi-task-meta')].every(e=>!e.textContent.includes('考研数学')));
assert.equal(emptyView.contentEl.querySelector('.lubi-plan-progress').getAttribute('aria-valuemax'),'2');
assert.equal(emptyView.contentEl.querySelector('.lubi-plan-progress').getAttribute('aria-valuenow'),'0');
const child=flat.querySelector('[data-task-id="flat-first"]');assert(child.querySelector('input[type=checkbox]')&&child.querySelector('.lubi-task-start'));
child.querySelector('.lubi-task-title-button').click();await settle();let form=O.openModals.at(-1);assert.equal(form.t.id,'flat-first');form.close();
await emptyPlugin.tasks.upsert({...emptyPlugin.tasks.byId('flat-mid'),start:'07:00',estimate:15});
emptyView.show('today',D);await settle();flat=emptyView.contentEl.querySelector('.lubi-plan-task-list');
assert.equal(flat.querySelectorAll('[data-task-id="flat-mid"]').length,1,'parent with independent time remains actionable');
assert.equal(emptyView.contentEl.querySelector('.lubi-plan-progress').getAttribute('aria-valuemax'),'3');
await emptyPlugin.journal.add({date:D,start:'06:00',minutes:10,title:'考研数学实际活动',category:'学习',task:'flat-root',extra:{}});
emptyView.show('today',D);await settle();flat=emptyView.contentEl.querySelector('.lubi-plan-task-list');
assert(flat.querySelector('[data-task-id="flat-root"]'),'parent with actual record retained');
assert.equal(emptyView.contentEl.querySelector('.lubi-plan-progress').getAttribute('aria-valuemax'),'4');
assert.equal(emptyView.contentEl.querySelector('.lubi-plan-progress').getAttribute('aria-valuenow'),'0','actual record is not completion');
console.log('PASS flat daily actions: date-only grouping parents excluded, context metadata, progress, time ordering, editing, independent parents and actual records retained');
assert(!root.querySelector('.lubi-error'));emptyPlugin.onunload();plugin.onunload();await view.onClose();await fresh.view.onClose();await emptyView.onClose();
console.log('PASS planning interactions: nine modes, shared navigation, clean views, date moves, recurrence edit/completion, parent context, empty axes and session defaults');
