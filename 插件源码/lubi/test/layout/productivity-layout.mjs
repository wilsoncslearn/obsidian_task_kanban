// Browser geometry of synthetic production UI; not real Obsidian/mobile acceptance.
import assert from 'node:assert/strict';
import * as O from '../helpers/mock-obsidian.js';
import Module,{createRequire} from 'node:module';
import {existsSync,mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {blankTask,todayStr,shiftDate} from '../.out/core.mjs';
import { findBrowser } from "../helpers/browser.mjs";
import { writePage } from "../helpers/page.mjs";
const original=Module._load;Module._load=function(id,...args){return id==='obsidian'?O:original.call(this,id,...args)};
const Plugin=createRequire(import.meta.url)(process.env.LUBI_TEST_PLUGIN||'../../main.js').default;
const browser = findBrowser();
if(!browser)throw Error('Native browser required for productivity layout');
const app=new O.App(),p=new Plugin(app,{id:'lubi'});await p.onload();await p.tasks.load();
await p.tasks.upsert(blankTask({id:'layout-product',title:'合成任务：核对一份足够长的交付与验收说明',category:'学习',date:shiftDate(todayStr(),-1),budgetMinutes:120,outcome:{links:['[[合成说明#验收]]'],criteria:[{text:'完成合成验收',done:false}],history:[]}}));
const tmp=mkdtempSync(join(tmpdir(),'lubi-product-layout-'));
const styles=readFileSync(new URL('../../styles.css',import.meta.url),'utf8');
const esc=s=>s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
try{
 for(const tab of ['cost','review','backlog','timer','restore']){
  if(tab==='timer')p.settings.focusTimer={id:'layout',task:'layout-product',title:'合成计时',category:'学习',segments:[{from:Date.now()-120000,to:Date.now()}]};
  p.openProduct(tab);await new Promise(r=>setTimeout(r,80));const m=O.openModals.at(-1);assert(!m.contentEl.textContent.includes('读取失败'));m.modalEl.classList.add('modal');m.contentEl.classList.add('modal-content');const html=m.modalEl.outerHTML;m.close();
  for(const theme of ['light','dark'])for(const width of [320,900]){
   const shim=`:root{--background-primary:${theme==='dark'?'#111':'#fff'};--background-modifier-border:#888;--text-normal:${theme==='dark'?'#eee':'#111'};--text-muted:#888;--interactive-accent:#333;--text-on-accent:#fff}html,body{margin:0;font:14px sans-serif;background:var(--background-primary);color:var(--text-normal)}*{box-sizing:border-box}.modal{padding:16px;margin:10px auto}.modal-content{min-width:0}input,select,textarea,button{font:inherit;color:inherit;background:var(--background-primary);border:1px solid #888}button{border-radius:5px}h2{font-size:20px}`;
   const probe=`<script>addEventListener('load',()=>{const m=document.querySelector('.modal'),c=document.querySelector('.modal-content'),r=m.getBoundingClientRect();c.scrollTop=c.scrollHeight;const controls=[...c.querySelectorAll('input,select,textarea,button')].filter(e=>e.getBoundingClientRect().width>0);const out={width:innerWidth,overflow:document.documentElement.scrollWidth-innerWidth,contained:controls.every(e=>{const b=e.getBoundingClientRect();return b.left>=r.left-1&&b.right<=r.right+1}),named:controls.every(e=>e.textContent.trim()||e.closest('label')||e.getAttribute('aria-label')||e.getAttribute('aria-labelledby'))};parent.postMessage('PRODUCT:'+encodeURIComponent(JSON.stringify(out)),'*')});<\/script>`;
   const source=`<!doctype html><html><head><meta charset="utf-8"><style>${shim}${styles}</style></head><body class="theme-${theme}">${html}${probe}</body></html>`;
   const wrapper=`<!doctype html><meta charset="utf-8"><style>body{margin:0}iframe{border:0;width:${width}px;height:800px}</style><script>addEventListener('message',e=>{if(typeof e.data==='string'&&e.data.startsWith('PRODUCT:')){const p=document.createElement('pre');p.textContent=e.data;document.body.append(p)}})</script><iframe srcdoc="${esc(source)}"></iframe>`;
   const file=join(tmp,`${tab}-${theme}-${width}.html`);writePage(file,wrapper);
   const result=spawnSync(browser,['--headless=new','--disable-gpu','--disable-extensions','--disable-background-networking','--no-first-run','--no-default-browser-check','--window-size=1200,900','--virtual-time-budget=2000',`--user-data-dir=${join(tmp,`${tab}-${theme}-${width}-profile`)}`,'--dump-dom',pathToFileURL(file).href],{encoding:'utf8',timeout:45000,maxBuffer:10*1024*1024});
   assert.equal(result.status,0,result.stderr);const found=[...result.stdout.matchAll(/PRODUCT:(%7B[^<\s]+)/g)].at(-1);assert(found,'missing browser metrics');const metrics=JSON.parse(decodeURIComponent(found[1]));assert.equal(metrics.width,width);assert(metrics.overflow<=1&&metrics.contained&&metrics.named,JSON.stringify({tab,theme,...metrics}));console.log(`PASS productivity browser ${tab} ${theme} ${width}px`);
  }
 }
}finally{p.onunload();rmSync(tmp,{recursive:true,force:true})}
