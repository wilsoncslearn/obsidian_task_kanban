// Approved MONO integration against the actual bundle; synthetic memory Vault only.
import assert from 'node:assert/strict';
import Module from 'node:module';
import {createRequire} from 'node:module';
import * as O from '../helpers/mock-obsidian.js';
const load=Module._load;Module._load=function(name,...args){return name==='obsidian'?O:load.call(this,name,...args)};
const Plugin=createRequire(import.meta.url)(process.env.LUBI_TEST_PLUGIN||'../.out/plugin.cjs').default;
const {blankTask,todayStr,shiftDate,backgroundRun,PENDING_KEY,serializeRecord}=await import('../.out/core.mjs');
const app=new O.App(),plugin=new Plugin(app,{id:'lubi',version:'1.7.1'});
await plugin.onload();await plugin.tasks.load();
const D=todayStr(),previous=shiftDate(D,-1),wait=ms=>new Promise(r=>setTimeout(r,ms)),settle=()=>wait(240);
const view=await plugin.activateView('tasks',D);await settle();
const root=view.contentEl;
assert.equal(view.tasksState.scheduleView,'list');assert.equal(view.tasksState.period,'day');
const categorySnapshot=JSON.stringify(plugin.settings.categories);
view.openNew();await wait(20);const Form=O.openModals.at(-1).constructor;O.openModals.at(-1).close();
const open=async options=>{const form=new Form(app,plugin,{recordDate:D,...options});form.open();await form.actualLoading;return form};
const input=(form,selector,value,event='input')=>{const field=form.contentEl.querySelector(selector);assert(field,selector);field.value=value;field.dispatchEvent(new window.Event(event,{bubbles:true}));};
const rows=async (id,date=D)=>(await plugin.journal.read(date)).filter(row=>row.rec.task===id);
const bytes=()=>JSON.stringify([...app.vault.files]);
const save=async form=>{form.contentEl.querySelector('[data-actual-action=record]').click();await settle()};
const row=id=>root.querySelector(`.lubi-task[data-task-id="${id}"]`);
const person=await plugin.tasks.upsert(blankTask({id:'mono-self',title:'合成本人任务',category:'学习',date:D,estimate:30,location:'保留地点',custom:{keep:true}}));
const inbox=await plugin.tasks.upsert(blankTask({id:'mono-inbox',title:'合成未安排',category:'日常'}));
const agent=await plugin.tasks.upsert(blankTask({id:'mono-agent',title:'合成历史结果',executor:'background',category:'日常',date:previous}));
await plugin.tasks.setBackgroundPhase(agent.id,previous,'running');await plugin.tasks.setBackgroundPhase(agent.id,previous,'review');
const running=await plugin.tasks.upsert(blankTask({id:'mono-running',title:'合成后台运行',executor:'background',category:'学习',date:D}));await plugin.tasks.setBackgroundPhase(running.id,D,'running');
await settle();
assert.equal(root.querySelector('.lubi-planning-main').firstElementChild,root.querySelector('.lubi-attention-card'));
assert(root.querySelector('.lubi-planning-main .lubi-selected-day-list'));
assert.deepEqual([...root.querySelector('.lubi-task-lists').children].slice(0,3).map(el=>el.classList.contains('lubi-background-card')?'background':el.classList.contains('lubi-personal-time')?'time':el.classList.contains('lubi-inbox-card')?'inbox':'other'),['background','time','inbox']);
assert(!root.querySelector('.lubi-selected-day-list [data-task-id=mono-running]'),'running is in background, not a duplicate day action');
const unchanged=bytes();let form=await open({task:person,actualRequired:true});
assert.equal(form.titleEl.firstElementChild.textContent,'记我的用时');assert(form.contentEl.querySelector('.lubi-time-task-context').textContent.includes(person.title));
assert.equal(form.contentEl.querySelector('.lubi-time-plan-details').open,false);assert.equal(document.activeElement,form.contentEl.querySelector('[data-actual=minutes]'));
assert.equal(form.contentEl.querySelector('[data-actual-action=complete]').checked,false);assert.equal(bytes(),unchanged);
form.close();assert.equal(bytes(),unchanged,'opening/cancelling does not rewrite data');

// Unticked Save records real human minutes, preserving metadata and the unfinished state.
form=await open({task:plugin.tasks.byId(person.id),actualRequired:true});input(form,'[data-actual=minutes]','5');input(form,'[data-actual=start]','09:00','change');
assert(form.saveButton.textContent.startsWith('保存用时'));await save(form);
assert.equal(plugin.tasks.byId(person.id).status,'todo');assert.equal((await rows(person.id))[0].rec.minutes,5);assert.equal((await rows(person.id))[0].rec.estimatedMinutes,30);assert.equal(plugin.tasks.byId(person.id).location,'保留地点');assert.deepEqual(plugin.tasks.byId(person.id).custom,{keep:true});
// Ticking is only a draft decision. Explicit Save performs both operations exactly once.
form=await open({task:plugin.tasks.byId(person.id),actualRequired:true});const beforeTick=bytes();form.contentEl.querySelector('[data-actual-action=complete]').click();assert.equal(bytes(),beforeTick);assert(form.saveButton.textContent.startsWith('保存用时并完成'));await save(form);
assert.equal(plugin.tasks.byId(person.id).status,'done');assert.equal((await rows(person.id)).length,1);
form=await open({task:plugin.tasks.byId(person.id),actualRequired:true});assert(form.contentEl.querySelector('[data-actual-action=complete]').checked);assert(form.contentEl.querySelector('[data-actual-action=complete]').disabled);form.close();
const actualText=serializeRecord((await rows(person.id))[0].rec);row(person.id).querySelector('input[type=checkbox]').click();await settle();assert.equal(serializeRecord((await rows(person.id))[0].rec),actualText);assert.equal(plugin.tasks.byId(person.id).status,'todo');

// Record an unplanned task, without introducing a planned date or forecast.
row(inbox.id).querySelector('.lubi-task-start').click();await wait(25);form=O.openModals.at(-1);await form.actualLoading;
input(form,'[data-actual=minutes]','7');input(form,'[data-actual=start]','10:00','change');await save(form);
assert.equal(plugin.tasks.byId(inbox.id).date,'');assert.equal(plugin.tasks.byId(inbox.id).estimate,0);assert.equal(plugin.tasks.byId(inbox.id).status,'todo');assert.equal((await rows(inbox.id))[0].rec.estimatedMinutes,undefined);
row(inbox.id).querySelector('input[type=checkbox]').click();await settle();assert.equal(plugin.tasks.byId(inbox.id).date,'');assert(root.querySelector('.lubi-planning-main .lubi-selected-day-list [data-task-id=mono-inbox]'));
row(inbox.id).querySelector('input[type=checkbox]').click();await settle();assert(root.querySelector('.lubi-inbox-card [data-task-id=mono-inbox]'));assert.equal((await rows(inbox.id)).length,1);

// The historical review remains visible on another day. Recording does not accept it.
view.show('tasks',shiftDate(D,-35));await settle();const review=root.querySelector('.lubi-attention-card [data-task-id=mono-agent]');assert(review);review.querySelector('[data-review-action=record]').click();await wait(25);form=O.openModals.at(-1);await form.actualLoading;
assert.equal(form.actualDate,D);assert.equal(form.opts.completionDate,previous);input(form,'[data-actual=minutes]','3');input(form,'[data-actual=start]','11:00','change');await save(form);
assert.equal(backgroundRun(plugin.tasks.byId(agent.id),previous).phase,'review');assert.equal((await rows(agent.id))[0].rec.date,D);
root.querySelector('.lubi-attention-card [data-task-id=mono-agent] [data-review-action=accept]').click();await settle();assert.equal(backgroundRun(plugin.tasks.byId(agent.id),previous).phase,'accepted');assert.equal((await rows(agent.id)).length,1);

// Actual date and repeat completion date are independently selectable in the real form.
const repeating=await plugin.tasks.upsert(blankTask({id:'mono-repeat-date',title:'合成跨日期重复任务',category:'学习',created:'2020-01-01T00:00:00Z',startDate:'2020-01-01',repeat:{kind:'daily',days:[]}}));
form=await open({task:repeating,actualRequired:true,completionDate:previous});
assert.equal(form.contentEl.querySelector('[data-actual=date]').disabled,false);
input(form,'[data-actual=date]',previous,'change');await form.actualLoading;
assert.equal(form.contentEl.querySelector('[data-actual=minutes]').value,'','another date never copies old effort');
input(form,'[data-actual=minutes]','2');input(form,'[data-actual=start]','12:30','change');form.contentEl.querySelector('[data-actual-action=complete]').click();await save(form);
assert.deepEqual(plugin.tasks.byId(repeating.id).doneDates,[previous]);assert.equal((await rows(repeating.id,previous))[0].rec.minutes,2);assert.equal((await rows(repeating.id,D)).length,0);
form=await open({task:plugin.tasks.byId(person.id),actualRequired:true,completionDate:D});assert.equal(form.actualText,'5min');input(form,'[data-actual=date]',previous,'change');await form.actualLoading;assert.equal(form.actualText,'');form.close();assert.equal((await rows(person.id,D))[0].rec.minutes,5,'switching and cancelling preserves the old record');

// A late date response never replaces the current date; a closed form ignores pending reads.
{
 const originalRead=plugin.journal.read.bind(plugin.journal);let release,gate=false;
 const oldRows=[{line:99,rec:{date:previous,start:'01:00',minutes:99,category:person.category,title:person.title,task:person.id,extra:{}}}];
 plugin.journal.read=async date=>date===previous&&gate?await new Promise(resolve=>{release=()=>resolve(oldRows)}):originalRead(date);
 try{
  form=await open({task:plugin.tasks.byId(person.id),actualRequired:true,completionDate:D});const before=bytes();gate=true;
  input(form,'[data-actual=date]',previous,'change');const stale=form.actualLoading;
  assert(form.saveButton.disabled&&form.contentEl.querySelector('[data-actual=minutes]').disabled&&form.contentEl.querySelector('[data-actual=start]').disabled,'busy reads block record mutation');
  assert.equal(typeof release,'function');input(form,'[data-actual=date]',D,'change');await form.actualLoading;assert.equal(form.actualText,'5min');release();await stale;
  assert.equal(form.actualDate,D);assert.equal(form.actualText,'5min');assert.equal(form.actualExisting.date,D);form.close();assert.equal(bytes(),before);
  gate=false;form=await open({task:plugin.tasks.byId(person.id),actualRequired:true});gate=true;input(form,'[data-actual=date]',previous,'change');const closed=form.actualLoading;form.close();release();await closed;assert.equal(form.actualText,'');assert.equal(bytes(),before,'closed response does not rewrite a record');
 }finally{plugin.journal.read=originalRead;form?.close()}
}
// Read failure blocks Save; it must never assume there are no pre-existing minutes.
{
 const originalRead=plugin.journal.read.bind(plugin.journal);plugin.journal.read=async date=>{if(date===previous)throw Error('Synthetic MONO lookup failure');return originalRead(date)};
 try{form=await open({task:plugin.tasks.byId(person.id),actualRequired:true});const before=bytes();input(form,'[data-actual=date]',previous,'change');await form.actualLoading;assert(form.saveButton.disabled);assert(form.contentEl.textContent.includes('无法读取实际记录'));await save(form);assert.equal(bytes(),before)}finally{plugin.journal.read=originalRead;form?.close()}
}
// Both concurrent completion and reopening preserve the latest status on record-only Save.
form=await open({task:plugin.tasks.byId(person.id),actualRequired:true,completionDate:D});await plugin.tasks.toggleDone(person.id,D);input(form,'[data-actual=minutes]','5');await save(form);assert.equal(plugin.tasks.byId(person.id).status,'done');assert.equal((await rows(person.id)).length,1);
form=await open({task:plugin.tasks.byId(person.id),actualRequired:true,completionDate:D});assert(form.contentEl.querySelector('[data-actual-action=complete]').disabled);await plugin.tasks.toggleDone(person.id,D);input(form,'[data-actual=minutes]','5');await save(form);assert.equal(plugin.tasks.byId(person.id).status,'todo');assert.equal((await rows(person.id)).length,1);

// Independent entry uses the existing record-origin association, not a new pending plan.
view.show('tasks',D);await settle();const todoCount=root.querySelector('[data-plan-metric=todo] .lubi-plan-metric-value').textContent;
root.querySelector('.lubi-personal-time-add').click();await wait(20);form=O.openModals.at(-1);
assert(form.contentEl.querySelector('.lubi-completion-choice').hidden);assert(!form.contentEl.querySelector('.lubi-plan-grid'));input(form,'input[type=text]','合成独立用时');input(form,'[data-actual=minutes]','9');input(form,'[data-actual=start]','12:00','change');await save(form);
const independent=plugin.tasks.all.find(task=>task.title==='合成独立用时');assert(independent);assert.equal(independent.origin,'record');assert.equal(independent.estimate,0);assert.equal(independent.status,'done');assert(!root.querySelector(`.lubi-selected-day-list [data-task-id="${independent.id}"]`));assert.equal(root.querySelector('[data-plan-metric=todo] .lubi-plan-metric-value').textContent,todoCount);assert.equal((await rows(independent.id))[0].rec.estimatedMinutes,undefined);

// Independent failure removes its journal write, and an existing task ID is never overwritten.
{
 form=await open({actualRequired:true,defaults:{title:'合成独立回滚'}});const id=form.t.id,originalUpsert=plugin.tasks.upsert.bind(plugin.tasks),beforeRecords=(await plugin.journal.read(D)).map(item=>serializeRecord(item.rec));
 input(form,'[data-actual=minutes]','4');input(form,'[data-actual=start]','15:00','change');plugin.tasks.upsert=async (task,...args)=>{if(task.id===id)throw Error('Synthetic independent task failure');return originalUpsert(task,...args)};
 try{await save(form);assert(O.openModals.includes(form));assert(!plugin.tasks.byId(id));assert.equal((await rows(id)).length,0);assert.deepEqual((await plugin.journal.read(D)).map(item=>serializeRecord(item.rec)),beforeRecords,'failed independent write restores existing actual rows')}finally{plugin.tasks.upsert=originalUpsert;form.close()}
 form=await open({actualRequired:true,defaults:{title:'合成禁止覆盖'}});form.t.id=person.id;input(form,'[data-actual=minutes]','4');input(form,'[data-actual=date]',shiftDate(D,-12),'change');const before=bytes();await save(form);assert(O.openModals.includes(form));assert.equal(bytes(),before,'independent entry cannot replace an existing task');form.close();
}

// A planned, unconfirmed backfill is not counted as verified human effort.
await plugin.journal.add({date:D,start:'13:00',minutes:20,title:'合成计划待确认',category:'学习',extra:{[PENDING_KEY]:'按计划'}});await settle();
assert.equal(root.querySelector('[data-plan-metric=actual] .lubi-plan-metric-value').textContent,'24min');assert(root.querySelector('[data-plan-metric=actual] .lubi-plan-metric-note').textContent.includes('未计入'));
assert(root.querySelector('.lubi-personal-time-list').textContent.includes('待核对'));assert.equal((await rows(running.id)).length,0,'background clocks never create journal minutes');
for(const value of ['0','25h','abc']){form=await open({actualRequired:true,defaults:{title:'无效独立用时'+value}});input(form,'[data-actual=minutes]',value);const before=bytes();await save(form);assert(O.openModals.includes(form));assert.equal(bytes(),before);form.close();}
assert.equal(JSON.stringify(plugin.settings.categories),categorySnapshot,'stored category names and colors are unchanged');
assert.equal(JSON.parse(app.vault.files.get('任务/任务数据.json')).version,14);
view.show('today',D);await settle();assert.equal(view.tasksState.scheduleView,'calendar');assert.equal(view.tasksState.period,'day','legacy today command still opens the daily timeline');
plugin.onunload();await view.onClose();console.log('PASS MONO production integration: approved hierarchy, named record action, opt-in completion, cancel/stale-read/closed/read-failure safety, concurrent status, independent rollback/collision, metadata, unplanned completion/undo, cross-date review, independent time, no fabricated human/forecast time and unchanged categories/schema');
