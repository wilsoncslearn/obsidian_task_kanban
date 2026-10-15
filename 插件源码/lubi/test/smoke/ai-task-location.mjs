// Synthetic request + in-memory Vault only; no network or personal data.
import assert from 'node:assert/strict';
import * as O from '../helpers/mock-obsidian.js';
import Module from 'node:module';
import {createRequire} from 'node:module';
const load=Module._load;Module._load=function(id,...args){return id==='obsidian'?O:load.call(this,id,...args)};
const Plugin=createRequire(import.meta.url)(process.env.LUBI_TEST_PLUGIN||'../.out/plugin.cjs').default;
const app=new O.App(),plugin=new Plugin(app,{id:'lubi',version:'1.7.1'});await plugin.onload();await plugin.tasks.load();
plugin.settings.aiEndpoint='https://synthetic.invalid/v1';plugin.settings.aiModel='synthetic-model';
const view=await plugin.activateView('tasks','2026-10-11'),wait=()=>new Promise(r=>setTimeout(r,60));await wait();
const launch=async draft=>{O.setRequestUrlHandler(options=>{const system=JSON.parse(options.body).messages[0].content;assert(system.includes('location')&&system.includes('地点未提及时留空')&&system.includes('不从主任务继承'));return {status:200,json:{choices:[{message:{content:JSON.stringify(draft)}}]}}});view.contentEl.querySelector('.lubi-topbar-ai').click();const modal=O.openModals.at(-1);modal.input.value='在图书馆复习，然后整理错题';await modal.parse();return modal};
let ai=await launch({title:'复习章节',category:'学习',location:'  图书馆  ',subtasks:[{title:'整理错题'},{title:'讨论习题',location:'教室'}]});
assert(ai.result.textContent.includes('图书馆'));assert.equal(plugin.tasks.all.length,0,'parse never saves');ai.confirm();
let form=O.openModals.at(-1);assert.equal(form.contentEl.querySelector('[data-task-location]').value,'图书馆');await form.save();await wait();
form=O.openModals.at(-1);assert.equal(form.t.title,'整理错题');assert.equal(form.contentEl.querySelector('[data-task-location]').value,'');await form.save();await wait();
form=O.openModals.at(-1);assert.equal(form.t.title,'讨论习题');assert.equal(form.contentEl.querySelector('[data-task-location]').value,'教室');form.close();
assert.equal(plugin.tasks.all.length,2,'cancelled later draft never saves');assert.equal(plugin.tasks.all[0].location,'图书馆');assert.equal(plugin.tasks.all[1].location,'');
ai=await launch({title:'无地点旧响应',category:'学习'});assert.equal(ai.draft.location,undefined);ai.confirm();form=O.openModals.at(-1);assert.equal(form.t.location,'');form.close();
for(const location of [42,'x'.repeat(201)]){ai=await launch({title:'错误地点',location});assert(ai.result.textContent.includes('解析失败'));assert.equal(ai.draft,null);ai.close();}
assert.equal(plugin.tasks.all.length,2);assert(![...app.vault.files.keys()].some(n=>n.startsWith('日记/')));
O.setRequestUrlHandler(null);plugin.onunload();await view.onClose();
console.log('PASS AI location: system prompt, preview, trimmed transfer, explicit later location, no inheritance, omitted legacy field, validation and cancel');
