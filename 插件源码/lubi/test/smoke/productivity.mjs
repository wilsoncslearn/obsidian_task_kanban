// Synthetic in-memory Vault; never opens user records or sends requests.
import assert from 'node:assert/strict';
import * as O from '../helpers/mock-obsidian.js';
import Module from 'node:module';
import {createRequire} from 'node:module';
import {blankTask, effort, timerRecords, timerElapsed, pauseTimer, parseRestore, restoreWarnings, validateAiUrl, validateOutcome, todayStr, shiftDate, weekStart} from '../.out/core.mjs';
const load=Module._load;Module._load=function(id,...args){return id==='obsidian'?O:load.call(this,id,...args)};
const Plugin=createRequire(import.meta.url)(process.env.LUBI_TEST_PLUGIN||'../.out/plugin.cjs').default;
const app=new O.App(),p=new Plugin(app,{id:'lubi',version:'1.7.1'});await p.onload();await p.tasks.load();
const today=todayStr();const t=blankTask({id:'product-task',title:'合成任务',category:'学习',date:shiftDate(today,-2),estimate:60});await p.tasks.upsert(t);
const project=await p.tasks.addProject('合成项目');await p.tasks.upsert({...p.tasks.byId(t.id),project:project.id});await p.tasks.setProjectBudget(project.id,300);assert.equal(p.tasks.projectList[0].budgetMinutes,300);
const base={date:today,start:'09:00',minutes:30,title:t.title,category:'学习',task:t.id,extra:{},estimatedMinutes:60};
const totals=effort([base,{...base,start:'10:00',minutes:45},{...base,extra:{待确认:'按计划'}}],new Set([t.id]));assert.equal(totals.actual,75);assert.equal(totals.pending,30);assert.equal(totals.rows.length,3);
const before=JSON.parse(JSON.stringify(p.tasks.byId(t.id)));await p.product.arrange([before],'date',today);assert.equal(p.tasks.byId(t.id).date,today);assert.equal(p.tasks.byId(t.id).reschedules,1);await p.product.undoArrange();assert.deepEqual(p.tasks.byId(t.id),before);
await p.product.arrange([before],'archive');assert(!p.tasks.all.some(x=>x.id===t.id));assert(p.tasks.byId(t.id));await p.product.undoArrange();
await p.product.arrange([before],'unschedule');await p.tasks.upsert({...p.tasks.byId(t.id),title:'并发修改'});await assert.rejects(()=>p.product.undoArrange(),/变化/);assert.equal(p.tasks.byId(t.id).title,'并发修改');
await assert.rejects(()=>p.tasks.productBatch([{before,after:{...before,budgetMinutes:30}}]),/变化/);
await p.tasks.upsert({...p.tasks.byId(t.id),title:t.title});
assert.throws(()=>validateOutcome({links:['javascript:alert(1)'],criteria:[],history:[]}));validateOutcome({links:['[[说明#验收]]','https://example.invalid'],criteria:[{text:'可执行',done:true}],history:[]});
assert.throws(()=>validateOutcome({links:[],criteria:[],history:[{at:new Date().toISOString(),link:'',outcome:'rework',reason:''}]}));
const start=new Date(2026,9,13,23,30).getTime(),stop=new Date(2026,9,14,0,30).getTime();
const session={id:'timer-synthetic',task:t.id,title:t.title,category:t.category,segments:[{from:start,to:stop}]};assert.equal(timerElapsed(session),3600000);const pieces=timerRecords(session);assert.equal(pieces.length,2);assert.deepEqual(pieces.map(r=>r.minutes),[30,30]);assert.equal(pieces[1].start,'00:00');assert.throws(()=>pauseTimer({...session,runningSince:100},99));
p.settings.focusTimer=session;
const add=p.journal.add.bind(p.journal);let fail=true;p.journal.add=async r=>{if(r.date===pieces[1].date&&fail){fail=false;throw Error('synthetic disk failure')}return add(r)};
await assert.rejects(()=>p.product.commitTimer(session.id),/disk failure/);assert(p.settings.focusTimer);await p.product.commitTimer(session.id);assert.equal(p.settings.focusTimer,undefined);assert.equal((await p.journal.read(pieces[0].date)).length,1);assert.equal((await p.journal.read(pieces[1].date)).length,1);assert.equal(p.tasks.byId(t.id).status,'todo');
await p.product.startTimer(p.tasks.byId(t.id));await assert.rejects(()=>p.product.startTimer(p.tasks.byId(t.id)),/已有计时/);await p.product.toggleTimer();assert.equal(p.settings.focusTimer.runningSince,undefined);await p.product.discardTimer();
const week=weekStart(today),reviewPath=`Lubi-复盘/${week}.md`;
await p.product.saveReview(today,'减少切换',['下周合成行动'],t.category,true,null);assert(app.vault.files.has(reviewPath));const count=p.tasks.all.length;const report=app.vault.files.get(reviewPath);
await p.product.saveReview(today,'减少切换',['下周合成行动'],t.category,true,report);assert.equal(p.tasks.all.length,count);await assert.rejects(()=>p.product.saveReview(today,'x',[],t.category,false,'stale'),/变化/);
await p.exportJson();const exportPath=[...app.vault.files.keys()].find(x=>/^Lubi-导出-/.test(x));const raw=app.vault.files.get(exportPath),data=parseRestore(raw);assert.equal(data.format,'lubi-data');
assert.throws(()=>parseRestore(JSON.stringify({...data,version:2})));assert.throws(()=>parseRestore(JSON.stringify({...data,records:[{...base,date:'../../escape'}]})));assert.throws(()=>parseRestore(JSON.stringify({...data,taskStore:{...data.taskStore,tasks:[t,t]}})));
assert(restoreWarnings({...data,records:[base,base]}).some(x=>x.includes('重复')));
const saved=new Map(app.vault.files),settings=JSON.stringify(p.settings);const root=await p.product.restore(raw);for(const [path,text]of saved)assert.equal(app.vault.files.get(path),text);assert.equal(JSON.stringify(p.settings),settings);assert(app.vault.files.has(root+'/恢复说明.md'));assert.deepEqual(JSON.parse(app.vault.files.get(root+'/任务数据.json')),data.taskStore);
const root2=await p.product.restore(raw);assert.notEqual(root,root2);
const create=app.vault.create.bind(app.vault);app.vault.create=async(path,text)=>{if(path.endsWith('/任务数据.json'))throw Error('synthetic restore failure');return create(path,text)};await assert.rejects(()=>p.product.restore(raw),/隔离恢复未完成/);app.vault.create=create;for(const [path,text]of saved)assert.equal(app.vault.files.get(path),text);
let persisted;p.saveData=async x=>{persisted=JSON.parse(JSON.stringify(x))};p.settings.aiApiKey='SYNTHETIC_SECRET';await p.saveSettings();assert.equal(persisted.aiApiKey,'');assert.equal(p.settings.aiApiKey,'SYNTHETIC_SECRET');
validateAiUrl('https://example.invalid/v1');validateAiUrl('http://127.0.0.1:11434/v1');assert.throws(()=>validateAiUrl('http://example.invalid'));assert.throws(()=>validateAiUrl('file:///etc/passwd'));assert.throws(()=>validateAiUrl('https://user:secret@example.invalid'));
// Exposed commands + each modal opens without render errors. No sensitive fixture data.
const wait=()=>new Promise(r=>setTimeout(r,100));
for(const tab of ['cost','review','backlog','timer','restore']){
 assert(p.commands.some(c=>c.id==='product-'+tab));p.openProduct(tab);await wait();const instance=O.openModals.at(-1),modal=instance.modalEl;assert(modal,'modal exists');assert(!modal.textContent.includes('读取失败'),modal.textContent);assert(modal.querySelector('button'));instance.close();
}
// Exercise save buttons, not just static rendering.
p.openProduct('cost');await wait();let m=O.openModals.at(-1),el=m.contentEl;
let select=el.querySelector('select');select.value='t:'+t.id;select.dispatchEvent(new Event('change'));await wait();
const button=(text)=>[...el.querySelectorAll('button')].find(b=>b.textContent===text);
el.querySelector('input[type=number]').value='180';button('保存预算').click();await wait();assert.equal(p.tasks.byId(t.id).budgetMinutes,180);
select=el.querySelector('select');select.value='t:'+t.id;select.dispatchEvent(new Event('change'));await wait();
el.querySelectorAll('textarea')[0].value='[[验收说明]]';el.querySelectorAll('textarea')[1].value='- [x] 合成条件';el.querySelectorAll('select')[1].value='accepted';button('保存成果与验收').click();await wait();assert.equal(p.tasks.byId(t.id).outcome.history.length,1);assert.equal(p.tasks.byId(t.id).status,'todo');m.close();
// Restart restores paused timer state without including an API key.
p.settings.focusTimer=session;await p.saveSettings();const restarted=new Plugin(app,{id:'lubi'});restarted.loadData=async()=>persisted;await restarted.onload();assert.equal(restarted.settings.focusTimer.id,session.id);assert.equal(restarted.settings.aiApiKey,'');restarted.onunload();
p.onunload();console.log('PASS productivity: totals, budget, conflict guards, batch/undo/archive, evidence, timer/pause/midnight/retry, review idempotency, isolated restore validation/failure, session-only key, URL safety, all five modal tabs');
