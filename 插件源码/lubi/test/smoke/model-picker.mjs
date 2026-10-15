// Public settings fetch/select flow, synthetic HTTP and credentials only.
import assert from 'node:assert/strict';
import * as O from '../helpers/mock-obsidian.js';
import Module from 'node:module';
import {createRequire} from 'node:module';
const load=Module._load;Module._load=function(id,...args){return id==='obsidian'?O:load.call(this,id,...args)};
const Plugin=createRequire(import.meta.url)(process.env.LUBI_TEST_PLUGIN||'../.out/plugin.cjs').default;
const app=new O.App(),plugin=new Plugin(app,{id:'lubi',version:'1.6.0'});await plugin.onload();
plugin.settings.aiEndpoint='https://synthetic.invalid/v1';plugin.settings.aiModel='deepseek-flash';let writes=0;plugin.saveSettings=async()=>{writes++};
const tab=plugin.settingTabs[0];document.body.append(tab.containerEl);tab.display();const root=tab.containerEl;root.querySelector('.lubi-settings-ai').open=true;
const input=root.querySelector('[data-setting=ai-model]'),fetch=[...root.querySelectorAll('button')].find(b=>b.textContent==='获取模型列表');
const names=['deepseek-flash','deepseek-v4.1-flash',...Array.from({length:34},(_,i)=>'other-model-'+i)];let requests=0;
O.setRequestUrlHandler(()=>{requests++;return {status:200,json:{data:names.map(id=>({id}))}}});
const wait=()=>new Promise(r=>setTimeout(r,100));fetch.click();await wait();
let list=root.querySelector('.lubi-model-options');assert(list&&!list.hidden,'fetch should open the themed list rather than a native filtered datalist');assert.equal(list.querySelectorAll('[role=option]').length,36,'fetch shows every model despite existing input value');assert.equal(input.value,'deepseek-flash');assert.equal(plugin.settings.aiModel,'deepseek-flash');assert.equal(writes,0,'fetching never replaces or saves the chosen model');assert(!input.hasAttribute('list')&&!root.querySelector('datalist'),'no unthemed native model suggestions');
input.value='DeEpSeEk';input.dispatchEvent(new window.Event('input',{bubbles:true}));assert.equal(list.querySelectorAll('[role=option]').length,2);assert.equal(writes,1);assert.equal(document.getElementById(list.getAttribute('aria-labelledby')).textContent,'可用 AI 模型','filtering preserves accessible list name');
input.click();assert.equal(list.querySelectorAll('[role=option]').length,36,'click reopen clears filtering but preserves text');assert.equal(input.value,'DeEpSeEk');
list.querySelectorAll('[role=option]')[2].click();assert.equal(input.value,names[2]);assert.equal(plugin.settings.aiModel,names[2]);assert(list.hidden);assert.equal(writes,2);
input.focus();assert.equal(list.querySelectorAll('[role=option]').length,36);input.dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));assert(input.getAttribute('aria-activedescendant'));input.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));assert.equal(plugin.settings.aiModel,names[0]);assert(list.hidden);
input.click();input.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert(list.hidden);input.click();input.blur();assert(list.hidden);
input.value='no-match';input.dispatchEvent(new window.Event('input',{bubbles:true}));assert(!list.hidden&&list.textContent.includes('无匹配模型'));assert.equal(list.querySelectorAll('[role=option]').length,0);input.click();assert.equal(list.querySelectorAll('[role=option]').length,36);input.dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true}));assert.equal(document.getElementById(input.getAttribute('aria-activedescendant')).textContent,names.at(-1));
const arrow=root.querySelector('.lubi-model-toggle');arrow.click();assert(list.hidden);arrow.click();assert(!list.hidden&&list.querySelectorAll('[role=option]').length===36);
// Fetch again with a manually chosen model not in the service list: don't replace it.
input.value='manual-custom-model';input.dispatchEvent(new window.Event('input',{bubbles:true}));const before=writes;fetch.click();fetch.click();await wait();assert.equal(input.value,'manual-custom-model');assert.equal(plugin.settings.aiModel,'manual-custom-model');assert.equal(writes,before);assert.equal(requests,2,'in-flight repeated fetch does not duplicate requests');assert.equal(list.querySelectorAll('[role=option]').length,36);
O.setRequestUrlHandler(()=>({status:200,json:{data:[]}}));fetch.click();await wait();assert.equal(input.value,'manual-custom-model');assert.equal(list.querySelectorAll('[role=option]').length,36,'empty result keeps previous list');assert(O.notices.at(-1).includes('获取模型列表失败'));
O.setRequestUrlHandler(()=>{throw Error('synthetic failure')});fetch.click();await wait();assert.equal(input.value,'manual-custom-model');assert.equal(list.querySelectorAll('[role=option]').length,36);
let resolve;O.setRequestUrlHandler(()=>new Promise(r=>resolve=r));fetch.click();await wait();input.value='during-fetch';input.dispatchEvent(new window.Event('input',{bubbles:true}));resolve({status:200,json:{models:[{name:'returned-name'},{model:'returned-model'},{name:'returned-name'}]}});await wait();assert.equal(input.value,'during-fetch');assert.equal(plugin.settings.aiModel,'during-fetch');assert.equal(list.querySelectorAll('[role=option]').length,2);
// Endpoint changes or settings rerender before a response: never publish stale candidates.
O.setRequestUrlHandler(()=>new Promise(r=>resolve=r));fetch.click();await wait();plugin.settings.aiEndpoint='https://changed.invalid';resolve({status:200,json:{data:[{id:'stale'}]}});await wait();assert(!list.textContent.includes('stale'));
O.setRequestUrlHandler(()=>new Promise(r=>resolve=r));fetch.click();await wait();tab.display();resolve({status:200,json:{data:[{id:'detached'}]}});await wait();assert(!root.textContent.includes('detached'));assert.equal(plugin.settings.aiModel,'during-fetch');
O.setRequestUrlHandler(null);plugin.onunload();root.remove();console.log('PASS model picker: all models on fetch/reopen, input-only filtering, click/keyboard/manual selection, cancellation, failures, in-flight guard, and stale responses');
