// Native Chromium rendering of production-generated synthetic HTML, not a real Obsidian client.
// srcdoc frames enforce the requested pane width even when headless Chrome has a minimum window width.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdtempSync,readFileSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,relative,isAbsolute,basename} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import { findBrowser } from "../helpers/browser.mjs";
import { writePage } from "../helpers/page.mjs";
import { DESIGN } from "../helpers/design.mjs";
const project=dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const browser = findBrowser();
if(!browser){if(process.env.LUBI_REQUIRE_BROWSER==='1')throw Error('Native browser required for MONO');console.log('SKIP MONO: browser unavailable');}
else{
 const temporary=mkdtempSync(join(tmpdir(),'lubi-mono-layout-'));
 const escape=text=>text.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
 try{
  for(const theme of ['light','dark'])for(const width of [1400,1024,820,620,390,320])for(const name of ['planning-list-day','async-workflow','modal-async']){
   let source=readFileSync(join(project,'preview',theme==='dark'?'dark':'',name+'.html'),'utf8');
   const native='<style>.modal{top:16px;max-height:calc(100vh - 32px);display:flex;flex-direction:column}.modal-content{min-height:0;overflow-y:auto}</style>';
   const probe=`<script>addEventListener('load',()=>{(document.fonts?.ready||Promise.resolve()).then(()=>setTimeout(()=>{
    const root=document.querySelector('.lubi-root')||document.querySelector('.lubi-modal'),modal=document.querySelector('.lubi-task-modal'),r=e=>{const b=e.getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width,height:b.height}},style=getComputedStyle(root),colors=[];
    const grayscale=value=>{const m=value.match(/^rgba?\\(([^)]+)\\)/);if(!m)return true;const rgb=m[1].split(/[,\\s/]+/).slice(0,3).map(Number);return Math.max(...rgb)-Math.min(...rgb)<1;};
    for(const element of root.querySelectorAll('*')){if(!element.getBoundingClientRect().width)continue;const computed=getComputedStyle(element);for(const property of ['color','backgroundColor','borderTopColor','fill','stroke'])if(computed[property]&&!grayscale(computed[property]))colors.push({cls:element.className.baseVal||element.className,property,value:computed[property]});}
    const attention=root.querySelector('.lubi-attention-card'),side=root.querySelector('.lubi-task-lists');
    const outside=document.createElement('button');outside.style.backgroundColor='var(--interactive-accent)';document.body.append(outside);const outsideAccent=getComputedStyle(outside).backgroundColor;outside.remove();
    let out={name:${JSON.stringify(name)},viewport:innerWidth,overflow:document.documentElement.scrollWidth-innerWidth,canvas:style.getPropertyValue('--color-canvas').trim(),ink:style.getPropertyValue('--color-ink').trim(),outsideAccent,nonGray:colors.slice(0,15),overview:root.querySelectorAll('.lubi-plan-metric').length,priority:!!attention&&attention.parentElement.firstElementChild===attention,sidebar:!!side&&!!side.querySelector('.lubi-background-card')&&!!side.querySelector('.lubi-personal-time')&&!!side.querySelector('.lubi-inbox-card'),unnamedButtons:[...root.querySelectorAll('button')].filter(b=>!b.textContent.trim()&&!b.getAttribute('aria-label')&&!b.getAttribute('aria-labelledby')).map(b=>b.outerHTML.slice(0,700)),personalEntries:[...root.querySelectorAll('.lubi-personal-time-entry')].map(b=>{const box=r(b);return {height:box.height,inside:[...b.children].filter(e=>r(e).width>0).every(e=>r(e).top>=box.top-.5&&r(e).bottom<=box.bottom+.5)}}),recordLabels:[...root.querySelectorAll('.lubi-task-start')].map(b=>b.querySelector(':scope > span')?.textContent.trim()),buttonsNamed:[...root.querySelectorAll('button')].every(b=>b.textContent.trim()||b.getAttribute('aria-label')||b.getAttribute('aria-labelledby')),recordText:[...root.querySelectorAll('.lubi-task-start')].every(b=>b.querySelector(':scope > span')?.textContent.trim()==='记用时')};
    if(modal){const content=modal.querySelector('.modal-content');content.scrollTop=content.scrollHeight;const save=modal.querySelector('[data-actual-action=record]'),complete=modal.querySelector('[data-actual-action=complete]'),box=r(content);out.modal={context:!!modal.querySelector('.lubi-time-task-context'),folded:!modal.querySelector('.lubi-time-plan-details').open,defaultIncomplete:!complete.checked,saveText:save.textContent,saveReachable:r(save).top>=box.top-1&&r(save).bottom<=box.bottom+1,inputsContained:[...content.querySelectorAll('input,select,textarea')].filter(e=>r(e).width>0).every(e=>r(e).left>=r(modal).left-.5&&r(e).right<=r(modal).right+.5)};}
    parent.postMessage('LUBI_MONO:'+encodeURIComponent(JSON.stringify(out)),'*');
   },0));});<\/script>`;
   source=source.replace('</head>',native+'</head>').replace('</body>',probe+'</body>');
   const wrapper=`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}iframe{border:0;display:block;width:${width}px;height:900px}</style><script>addEventListener('message',e=>{if(typeof e.data==='string'&&e.data.startsWith('LUBI_MONO:')){const p=document.createElement('pre');p.textContent=e.data;document.body.append(p);}});<\/script></head><body><iframe srcdoc="${escape(source)}"></iframe></body></html>`;
   const file=join(temporary,`${theme}-${width}-${name}.html`);writePage(file,wrapper,'utf8');
   const result=spawnSync(browser,['--headless=new','--disable-gpu','--disable-extensions','--disable-background-networking','--no-first-run','--no-default-browser-check','--force-device-scale-factor=1','--window-size=1600,1000','--virtual-time-budget=3500',`--user-data-dir=${join(temporary,`${theme}-${width}-${name}-profile`)}`,'--dump-dom',pathToFileURL(file).href],{encoding:'utf8',timeout:45000,maxBuffer:10*1024*1024});
   assert.equal(result.status,0,result.error||result.stderr?.slice(-500));const found=[...result.stdout.matchAll(/LUBI_MONO:(%7B[^<\s]+)/g)].at(-1);assert(found,'Missing MONO browser metrics');
   const metrics=JSON.parse(decodeURIComponent(found[1])),label=`${theme} ${width}px ${name}`;
   assert.equal(metrics.viewport,width,label+' must test the real requested pane width');assert(metrics.overflow<=1,label+' overflow: '+JSON.stringify(metrics));assert.equal(metrics.canvas,theme==='dark'?'#111111':'#ffffff');assert.equal(metrics.ink,theme==='dark'?'#f4f4f4':'#111111');assert.equal(metrics.nonGray.length,0,label+' non-grayscale component: '+JSON.stringify(metrics.nonGray));assert(metrics.outsideAccent!==`rgb(${theme==='dark'?'244, 244, 244':'17, 17, 17'})`,label+' cannot overwrite the outer application accent');assert(metrics.buttonsNamed&&metrics.recordText,label+' named controls: '+JSON.stringify(metrics));
   if(name==='modal-async')assert(metrics.modal.context&&metrics.modal.folded&&metrics.modal.defaultIncomplete&&metrics.modal.saveText.includes('保存用时')&&metrics.modal.saveReachable&&metrics.modal.inputsContained,label+' explicit reachable time entry: '+JSON.stringify(metrics));
   else {assert(metrics.overview===4&&metrics.priority&&metrics.sidebar,label+' approved hierarchy: '+JSON.stringify(metrics));assert(metrics.personalEntries.every(e=>e.height>=DESIGN.touchTargetPx&&e.inside),label+' human time entries do not clip/overlap: '+JSON.stringify(metrics.personalEntries));}
   console.log('PASS MONO native: '+label+', grayscale/scoped/contained/explicit');
  }
 }finally{const owner=realpathSync(tmpdir()),target=realpathSync(temporary),child=relative(owner,target);assert(child&&!child.startsWith('..')&&!isAbsolute(child)&&dirname(child)==='.'&&basename(child).startsWith('lubi-mono-layout-'));rmSync(target,{recursive:true,force:true});}
}
