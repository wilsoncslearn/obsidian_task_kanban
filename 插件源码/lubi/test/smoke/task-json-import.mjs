// Public import button + clipboard prompt + atomic append. Synthetic memory Vault only.
import assert from 'node:assert/strict';
import * as O from '../helpers/mock-obsidian.js';
import Module from 'node:module';
import {createRequire} from 'node:module';
import {blankTask,parseTaskImport,taskImportPrompt} from '../.out/core.mjs';
const load=Module._load;Module._load=function(id,...args){return id==='obsidian'?O:load.call(this,id,...args)};
const Plugin=createRequire(import.meta.url)(process.env.LUBI_TEST_PLUGIN||'../.out/plugin.cjs').default;
const app=new O.App(),plugin=new Plugin(app,{id:'lubi',version:'1.6.0'});await plugin.onload();await plugin.tasks.load();
const path=plugin.settings.taskFile,wait=()=>new Promise(r=>setTimeout(r,230));const view=await plugin.activateView('tasks','2026-10-08');await wait();const root=view.contentEl;
const button=root.querySelector('.lubi-topbar-import');assert(button&&button.nextElementSibling===root.querySelector('.lubi-topbar-ai'));assert(!button.classList.contains('mod-cta'));button.click();const modal=O.openModals.at(-1);assert.equal(modal.constructor.name,'JsonTaskImportModal');modal.close();
await plugin.tasks.upsert(blankTask({id:'existing',title:'已有任务',notes:'必须保留',category:'学习',customField:{keep:true}}));
const raw=JSON.parse(app.vault.files.get(path));raw.customRoot={keep:true};app.vault.files.set(path,JSON.stringify(raw));await plugin.tasks.load(true);
const parsed=()=>JSON.parse(app.vault.files.get(path));const count=()=>plugin.tasks.all.length;
const fixture={tasks:[{title:'主任务',category:'学习',location:'图书馆',date:'2026-10-08',subtasks:[{title:'子任务',start:'09:00',estimate:60}]}]};
const input=(m,text)=>{const i=m.contentEl.querySelector('textarea');i.value=text;i.dispatchEvent(new window.Event('input',{bubbles:true}));};const submit=m=>m.contentEl.querySelector('.mod-cta').click();const open=()=>{root.querySelector('.lubi-topbar-import').click();return O.openModals.at(-1)};
let m=open(),before=JSON.stringify([...app.vault.files]);input(m,'{"tasks":[{"title":"有效"},{"title":"坏日期","date":"wrong"}]}');submit(m);await wait();assert(O.openModals.includes(m));assert(!m.contentEl.querySelector('.lubi-form-error').hidden);assert.equal(JSON.stringify([...app.vault.files]),before);m.close();
m=open();input(m,JSON.stringify(fixture));before=app.vault.files.get(path);submit(m);submit(m);await wait();assert(!O.openModals.includes(m));assert.equal(count(),3);assert.equal(parsed().tasks.length,3);assert.deepEqual(parsed().customRoot,{keep:true});assert.deepEqual(parsed().tasks.find(t=>t.id==='existing').customField,{keep:true});assert.equal(app.vault.files.get(plugin.tasks.lastImportBackup),before);assert.equal(plugin.tasks.all.find(t=>t.title==='子任务').parent,plugin.tasks.all.find(t=>t.title==='主任务').id);assert(![...app.vault.files.keys()].some(name=>name.startsWith('日记/')));
assert.equal(parsed().tasks.find(t=>t.title==='主任务').location,'图书馆');assert.equal(parsed().tasks.find(t=>t.title==='子任务').location,'');
// Failed backup or file write never publishes any imported task into memory.
const backup=app.vault.adapter.write;app.vault.adapter.write=async()=>{throw Error('synthetic backup failure')};let total=count();m=open();input(m,JSON.stringify({tasks:[{title:'失败备份',category:'学习'}]}));submit(m);await wait();assert.equal(count(),total);assert(O.openModals.includes(m));m.close();app.vault.adapter.write=backup;
const processFile=app.vault.process.bind(app.vault);app.vault.process=async()=>{throw Error('synthetic task write failure')};total=count();before=app.vault.files.get(path);m=open();input(m,JSON.stringify({tasks:[{title:'失败写入',category:'学习'}]}));submit(m);await wait();assert.equal(count(),total);assert.equal(app.vault.files.get(path),before);assert(O.openModals.includes(m));m.close();app.vault.process=processFile;
// Existing file changed outside the model: do not overwrite it. Retry after a reload.
const external=parsed();external.tasks[0].notes='外部更新';app.vault.files.set(path,JSON.stringify(external));before=app.vault.files.get(path);await assert.rejects(plugin.tasks.addBatch(parseTaskImport('{"tasks":[{"title":"不要覆盖","category":"学习"}]}',['学习'])));assert.equal(app.vault.files.get(path),before);await plugin.tasks.load(true);
// A change between backup and process is rejected, retaining that external edit.
app.vault.process=async(file,fn)=>{const value=JSON.parse(app.vault.files.get(file.path));value.tasks[0].notes='备份后变化';app.vault.files.set(file.path,JSON.stringify(value));return processFile(file,fn)};
await assert.rejects(plugin.tasks.addBatch(parseTaskImport('{"tasks":[{"title":"不要覆盖2","category":"学习"}]}',['学习'])));assert.equal(parsed().tasks[0].notes,'备份后变化');app.vault.process=processFile;await plugin.tasks.load(true);
// A normal queued edit while importing is preserved, and cannot wipe imported rows.
let release;const gate=new Promise(r=>release=r);app.vault.process=async(file,fn)=>{await gate;return processFile(file,fn)};
const imported=plugin.tasks.addBatch(parseTaskImport('{"tasks":[{"title":"并发导入","category":"学习"}]}',['学习']));await new Promise(r=>setTimeout(r,30));const edited=plugin.tasks.upsert({...plugin.tasks.byId('existing'),notes:'同时编辑保留'});release();await Promise.all([imported,edited]);app.vault.process=processFile;assert(parsed().tasks.some(t=>t.title==='并发导入'));assert.equal(parsed().tasks.find(t=>t.id==='existing').notes,'同时编辑保留');assert(plugin.tasks.all.some(t=>t.title==='并发导入'));
// Copy is local and doesn't expose endpoint, key, task names, or history.
plugin.settings.aiApiKey='SYNTHETIC_SECRET_DO_NOT_COPY';plugin.settings.aiEndpoint='https://private.invalid';let copied='';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{copied=value}}});
const settings=plugin.settingTabs[0];settings.display();const host=settings.containerEl.querySelector('.lubi-settings-json-import'),prompt=host.querySelector('textarea');assert(prompt.readOnly);assert(!prompt.value.includes(plugin.settings.aiApiKey)&&!prompt.value.includes(plugin.settings.aiEndpoint)&&!prompt.value.includes('已有任务'));
const copyButton=[...host.querySelectorAll('button')].find(b=>b.textContent==='复制系统提示词');copyButton.click();await wait();assert.equal(copied,prompt.value);assert(copied.includes('tasks')&&copied.includes('subtasks')&&copied.includes('location')&&copied.includes('未明确提及地点'));
plugin.settings.categories.find(c=>c.kind==='time').name='新的时间分类';copyButton.click();await wait();assert(copied.includes('新的时间分类'));
Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('clipboard denied')}}});copyButton.click();await wait();assert.equal(prompt.selectionStart,0);assert.equal(prompt.selectionEnd,prompt.value.length);
// Corrupt store blocks import rather than replacing user data.
const badApp=new O.App(),badPlugin=new Plugin(badApp,{id:'lubi',version:'1.6.0'});await badPlugin.onload();badApp.vault.files.set(badPlugin.settings.taskFile,'not-json');await badPlugin.tasks.load(true);await assert.rejects(badPlugin.tasks.addBatch([blankTask({title:'禁止替换'})]));assert.equal(badApp.vault.files.get(badPlugin.settings.taskFile),'not-json');badPlugin.onunload();
plugin.onunload();await view.onClose();console.log('PASS JSON import: public entry, whole-batch validation, cancellation, double click, backups, failures, external updates, queued edits, hierarchy, and private-safe clipboard fallback');
