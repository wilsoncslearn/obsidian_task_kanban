// Local JSON export, synthetic in-memory Vault only. Never reads personal data.
import assert from 'node:assert/strict';
import * as O from '../helpers/mock-obsidian.js';
import Module from 'node:module';
import {createRequire} from 'node:module';
import {blankTask,parseTaskImport} from '../.out/core.mjs';
const load=Module._load;Module._load=function(id,...args){return id==='obsidian'?O:load.call(this,id,...args)};
const Plugin=createRequire(import.meta.url)(process.env.LUBI_TEST_PLUGIN||'../.out/plugin.cjs').default;
const app=new O.App(),plugin=new Plugin(app,{id:'lubi',version:'1.6.0'});await plugin.onload();await plugin.tasks.load();
const files=()=>[...app.vault.files.keys()].filter(p=>/^Lubi-导出-.*\.json$/.test(p));
const wait=()=>new Promise(r=>setTimeout(r,40));
await plugin.exportJson();assert.equal(files().length,1);let data=JSON.parse(app.vault.files.get(files()[0]));
assert.equal(data.format,'lubi-data');assert.equal(data.version,1);assert(Number.isFinite(Date.parse(data.exportedAt)));assert.deepEqual(data.taskStore,{version:14,tasks:[]});assert.deepEqual(data.records,[]);
await plugin.tasks.upsert(blankTask({id:'export-parent',title:'任务 "一", 中文',category:'学习',date:'2026-10-07',start:'09:00',estimate:45,location:'图书馆',notes:'第一行\n第二行',customField:{keep:true}}));
await plugin.tasks.upsert(blankTask({id:'export-child',title:'子任务',category:'学习',parent:'export-parent',repeat:{kind:'weekly',days:[3]},doneDates:['2026-10-07'],skipDates:['2026-10-14'],doneLogs:{'2026-10-07':{start:'09:00',minutes:60}}}));
await plugin.journal.add({date:'2026-10-07',start:'23:45',minutes:60,estimatedMinutes:45,title:'跨夜任务',category:'学习',task:'export-parent',notes:'备注 "保留", 中文',extra:{待确认:'实际开始未核对',自定义:'保留'}});
await plugin.journal.add({date:'2026-10-07',start:'12:00',minutes:0,title:'午饭',category:'财务',amount:25.5,expenseType:'餐饮',extra:{}});
const raw=JSON.parse(app.vault.files.get(plugin.settings.taskFile));raw.customRoot={keep:true};raw.tasks[0].notes='外部编辑必须导出\n不读取旧内存';app.vault.files.set(plugin.settings.taskFile,JSON.stringify(raw));
plugin.settings.aiApiKey='SYNTHETIC_EXPORT_SECRET';plugin.settings.aiEndpoint='https://private.invalid';
const source=new Map(app.vault.files),settingsBefore=JSON.stringify(plugin.settings),memoryBefore=JSON.stringify(plugin.tasks.all);
const originalCache=app.vault.cachedRead;app.vault.cachedRead=async()=>{throw Error('export must read fresh disk data')};
await plugin.exportJson();app.vault.cachedRead=originalCache;assert.equal(files().length,2);let text=app.vault.files.get(files().at(-1));data=JSON.parse(text);
assert.deepEqual(data.taskStore,raw);assert.equal(data.taskStore.tasks[0].location,"图书馆");assert.equal(data.records.length,3);assert(data.records.some(r=>r.estimatedMinutes===45));assert(data.records.some(r=>r.amount===25.5&&r.expenseType==='餐饮'));assert(data.records.some(r=>r.extra.自定义==='保留'&&r.extra.待确认==='实际开始未核对'));assert(data.records.some(r=>r.date==='2026-10-08'));assert(!text.includes(plugin.settings.aiApiKey)&&!text.includes(plugin.settings.aiEndpoint)&&!('settings'in data));
for(const [p,value]of source)assert.equal(app.vault.files.get(p),value,'export does not modify source files');assert.equal(JSON.stringify(plugin.settings),settingsBefore);assert.equal(JSON.stringify(plugin.tasks.all),memoryBefore);assert.throws(()=>parseTaskImport(text,['学习']),'complete data export is not the append-only AI task import format');
const command=plugin.commands.find(c=>c.name==='导出数据 JSON');assert(command);assert.equal(command.id,'export-csv','existing export hotkey stays bound');assert(!plugin.commands.some(c=>c.name.includes('CSV')));
const view=await plugin.activateView('tasks','2026-10-07');await wait();view.contentEl.querySelector('.lubi-more-btn').click();const menu=O.menus.at(-1);assert(!menu.items.some(i=>i.title.includes('CSV')));const item=menu.items.find(i=>i.title==='导出数据 JSON');assert(item);
let count=files().length;item.cb();for(let i=0;i<20&&files().length===count;i++)await wait();assert.equal(files().length,count+1);
count=files().length;command.callback();for(let i=0;i<20&&files().length===count;i++)await wait();assert.equal(files().length,count+1);assert.equal(new Set(files()).size,files().length,'repeated exports use distinct paths');
count=files().length;await Promise.all([plugin.exportJson(),plugin.exportJson()]);assert.equal(files().length,count+1,'rapid double click does not export twice');
const read=app.vault.read.bind(app.vault),create=app.vault.create.bind(app.vault);
for(const kind of ['task-read','journal-read','create']){
 count=files().length;const before=new Map(app.vault.files);
 app.vault.read=async f=>{if((kind==='task-read'&&f.path===plugin.settings.taskFile)||(kind==='journal-read'&&f.path.endsWith('.md')))throw Error('synthetic read failure');return read(f)};
 app.vault.create=async(p,v)=>{if(kind==='create'&&p.startsWith('Lubi-导出-'))throw Error('synthetic create failure');return create(p,v)};
 await plugin.exportJson();assert.equal(files().length,count);assert.deepEqual(app.vault.files,before);assert(O.notices.at(-1).includes('导出失败'));
 app.vault.read=read;app.vault.create=create;
}
const saved=app.vault.files.get(plugin.settings.taskFile);
for(const bad of ['not-json',JSON.stringify({version:14,notTasks:[]}),JSON.stringify({version:13,tasks:[]})]){app.vault.files.set(plugin.settings.taskFile,bad);const before=new Map(app.vault.files);await plugin.exportJson();assert.deepEqual(app.vault.files,before,'invalid/legacy task data is not migrated or replaced during export');assert(O.notices.at(-1).includes('导出失败'));}
app.vault.files.set(plugin.settings.taskFile,saved);await plugin.tasks.load(true);
// Export waits for a pending task write, then reads the saved file, not stale memory.
const processFile=app.vault.process.bind(app.vault);let release,started;const gate=new Promise(r=>release=r),ready=new Promise(r=>started=r);
app.vault.process=async(f,change)=>{if(f.path===plugin.settings.taskFile){started();await gate}return processFile(f,change)};
const writing=plugin.tasks.upsert({...plugin.tasks.byId('export-parent'),notes:'排队保存后的内容'});await ready;count=files().length;const exporting=plugin.exportJson();await wait();assert.equal(files().length,count);release();await Promise.all([writing,exporting]);app.vault.process=processFile;
assert.equal(JSON.parse(app.vault.files.get(files().at(-1))).taskStore.tasks.find(t=>t.id==='export-parent').notes,'排队保存后的内容');
await plugin.exportJson();assert.equal(files().length,count+2,'guard resets after failures and pending writes');assert(![...app.vault.files.keys()].some(p=>p.endsWith('.csv')));
plugin.onunload();await view.onClose();console.log('PASS JSON data export: tasks/records/spending, snapshots, unknown fields, fresh reads, no credentials or source mutations, empty data, command/menu, collisions, double click, failures, and queued writes');
