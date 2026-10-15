// Synthetic-only regression for the light editor; existing time-entry remains explicit.
import assert from 'node:assert/strict';
import * as O from '../helpers/mock-obsidian.js';
import Module,{createRequire} from 'node:module';
import fs from 'node:fs';
import {blankTask,todayStr} from '../.out/core.mjs';
const old=Module._load;Module._load=function(id,...args){return id==='obsidian'?O:old.call(this,id,...args)};
const Plugin=createRequire(import.meta.url)(process.env.LUBI_TEST_PLUGIN||'../../main.js').default;
const app=new O.App(),p=new Plugin(app,{id:'lubi'});await p.onload();await p.tasks.load();
const project=await p.tasks.addProject('合成项目');
let t=await p.tasks.upsert(blankTask({id:'light-test',title:'梳理单人创作者的职务分工与工作流',category:'学习',project:project.id,date:todayStr(),start:'09:00',estimate:45,location:'图书馆',notes:'覆盖选题、调研、策划、文案。',custom:{keep:true},startDate:todayStr(),endDate:todayStr()}));
await p.journal.add({date:todayStr(),start:'10:00',minutes:30,title:t.title,category:t.category,task:t.id,extra:{保留:'合成'}});
const wait=()=>new Promise(r=>setTimeout(r,70));p.quickLog();await wait();const Form=O.openModals.at(-1).constructor;O.openModals.at(-1).close();
const open=async()=>{const m=new Form(app,p,{task:p.tasks.byId(t.id),recordDate:todayStr()});m.open();await wait();return m};
let m=await open();let el=m.contentEl;
assert(m.modalEl.classList.contains('lubi-light-task'));assert(!el.querySelector('[data-actual]'));assert(!el.querySelector('.lubi-cat-picker'));assert(el.querySelector('[data-light-category]'));assert(!el.querySelector('.lubi-light-more').open);
assert(el.querySelector('[data-task-location]').closest('details'));assert(el.querySelector('.lubi-repeat-field').closest('details'));assert(el.querySelector('.lubi-plan-start-field').closest('details'));
assert(!el.querySelector('[data-task-project=select]').closest('details'));assert(el.querySelector('.lubi-project-create').hidden);assert(el.querySelector('.lubi-light-recording').textContent.includes('30min'));
assert(el.querySelector('.lubi-light-more summary').textContent.includes('图书馆'));assert(el.querySelector('.lubi-light-more summary').textContent.includes('09:00'));
const filesBefore=new Map(app.vault.files);await m.save();assert.equal(app.vault.files.get(p.journal.path(todayStr())),filesBefore.get(p.journal.path(todayStr())),'saving plan must not rewrite journal');const beforeTask=JSON.parse(filesBefore.get(p.settings.taskFile)).tasks[0];assert.deepEqual({...JSON.parse(app.vault.files.get(p.settings.taskFile)).tasks[0],updated:beforeTask.updated},beforeTask);
m=await open();el=m.contentEl;const initial=JSON.parse(JSON.stringify(p.tasks.byId(t.id)));const journalBefore=app.vault.files.get(p.journal.path(todayStr()));
m.titleInput.value='改好的标题';m.titleInput.dispatchEvent(new Event('input',{bubbles:true}));el.querySelector('[data-light-record]').click();await wait();assert.equal(O.openModals.at(-1),m);assert(O.notices.at(-1).includes('先保存'));
const more=el.querySelector('details');more.open=true;const location=el.querySelector('[data-task-location]');location.value='教室';location.dispatchEvent(new Event('input',{bubbles:true}));
let cat=el.querySelector('[data-light-category]');cat.value='运动';cat.dispatchEvent(new Event('change',{bubbles:true}));await wait();assert(m.contentEl.querySelector('.lubi-light-more').open,'disclosure survives category redraw');assert.equal(m.contentEl.querySelector('[data-task-location]').value,'教室');
await m.save();t=p.tasks.byId(t.id);assert.equal(t.category,'运动');assert.equal(t.location,'教室');assert.equal(t.title,'改好的标题');assert.deepEqual(t.custom,{keep:true});assert.equal(t.start,'09:00');assert.equal(t.estimate,45);assert.equal(t.notes,initial.notes);assert.equal(app.vault.files.get(p.journal.path(todayStr())),journalBefore,'planning edit cannot rewrite actual');
m=await open();el=m.contentEl;const sel=el.querySelector('[data-task-project=select]');sel.value=sel.querySelector('[data-project-create-option]').value;sel.dispatchEvent(new Event('change',{bubbles:true}));assert(!el.querySelector('.lubi-project-create').hidden);assert.equal(m.t.project,project.id,'choosing creation never clears membership');[...el.querySelectorAll('button')].find(b=>b.textContent.trim()==='取消新建').click();assert(el.querySelector('.lubi-project-create').hidden);assert.equal(m.t.project,project.id);m.close();
m=await open();m.contentEl.querySelector('.lubi-light-more').open=true;const span=m.contentEl.querySelector('[data-extra-name="任务跨度"]');span.querySelector('button').click();assert.equal(m.t.startDate,t.startDate,'collapse does not erase span');m.close();
m=await open();m.contentEl.querySelector('[data-light-record]').click();await wait();const actual=O.openModals.at(-1);assert.notEqual(actual,m);assert(actual.opts.actualRequired);assert(actual.contentEl.querySelector('[data-actual=minutes]'));assert.equal(actual.contentEl.querySelector('[data-actual=minutes]').value,'30min');actual.close();
// A failed display-only journal read never blocks saving a plan.
const range=p.journal.readRange.bind(p.journal);p.journal.readRange=async()=>{throw Error('synthetic read failure')};m=await open();m.t.notes='仍可保存计划';await m.save();assert.equal(p.tasks.byId(t.id).notes,'仍可保存计划');p.journal.readRange=range;
// A repeat validation error automatically opens More.
m=await open();m.t.repeat={kind:'weekly',days:[]};m.render();await m.save();assert(m.contentEl.querySelector('.lubi-light-more').open);assert(m.contentEl.querySelector('[aria-invalid=true]'));m.close();
// Snapshot only synthetic HTML for native browser geometry and user preview.
m=await open();m.modalEl.classList.add('modal');m.contentEl.classList.add('modal-content');m.titleEl.classList.add('modal-title');
for(const input of m.contentEl.querySelectorAll('input'))input.setAttribute('value',input.value);for(const textarea of m.contentEl.querySelectorAll('textarea'))textarea.textContent=textarea.value;for(const select of m.contentEl.querySelectorAll('select'))for(const opt of select.options)opt.toggleAttribute('selected',opt.selected);
fs.mkdirSync('preview',{recursive:true});fs.writeFileSync('preview/light-task-fragment.html',m.modalEl.outerHTML);m.close();p.onunload();console.log('PASS light task: collapsed defaults, persistent metadata, separate actual entry, no actual writes, create/cancel project, dirty guard, failed reads, repeat validation');
