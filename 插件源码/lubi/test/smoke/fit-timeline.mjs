// Synthetic: the day timeline keeps the tuned 56px hour spacing and renders the full day (it scrolls inside its panel).
import assert from 'node:assert/strict';
import * as O from '../helpers/mock-obsidian.js';
import Module,{createRequire} from 'node:module';
import {blankTask,todayStr} from '../.out/core.mjs';
const old=Module._load;Module._load=function(id,...args){return id==='obsidian'?O:old.call(this,id,...args)};
const Plugin=createRequire(import.meta.url)(process.env.LUBI_TEST_PLUGIN||'../../main.js').default;
const app=new O.App(),p=new Plugin(app,{id:'lubi'});await p.onload();await p.tasks.load();
await p.journal.add({date:todayStr(),start:'09:00',minutes:60,title:'合成记录',category:'学习',extra:{}});
const view=await p.activateView('today',todayStr());await new Promise(r=>setTimeout(r,240));
const tl=view.contentEl.querySelector('.lubi-timeline');assert(tl,'timeline rendered');
assert.equal(parseFloat(tl.dataset.hourPx),56,'hour spacing stays at the tuned 56px');
assert.equal(parseFloat(tl.style.height),24*56+48,'timeline extends to full day height');
const labels=[...tl.querySelectorAll('.lubi-hour-label')];assert.equal(labels.length,25);
assert(Math.abs(parseFloat(labels.at(-1).style.top)-(32+24*56))<=1,'24:00 at the extended bottom');
const block=tl.querySelector('.lubi-block');assert(block,'record block rendered');
assert(Math.abs(parseFloat(block.style.top)-(9*56))<=1.5,'record position uses the tuned scale');
assert.equal(view.contentEl.querySelectorAll('.lubi-timeline').length,1,'exactly one timeline');
p.onunload();console.log('PASS day timeline: tuned spacing, extended full day, single timeline');
