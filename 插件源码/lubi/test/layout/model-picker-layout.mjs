// Native model-list geometry/theme validation using public-fetch synthetic previews.
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
if(!browser){if(process.env.LUBI_REQUIRE_BROWSER==='1')throw new Error('Native browser required for themed models');console.log('SKIP model list native layout');}
else {
 const tmp=mkdtempSync(join(tmpdir(),'lubi-model-layout-'));
 try {
  for(const theme of ['light','dark'])for(const width of [850,600,390,320])for(const state of ['all','filtered']) {
   const name='settings-models-'+state,html=readFileSync(join(project,'preview',theme==='dark'?'dark':'',name+'.html'),'utf8');
   const probe=`<script>addEventListener('load',()=>{
    const root=document.querySelector('.lubi-settings'),input=root.querySelector('[data-setting=ai-model]'),picker=input.closest('.lubi-model-picker'),list=picker.querySelector('.lubi-model-options'),toggle=picker.querySelector('button'),options=[...list.querySelectorAll('[role=option]')];
    const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
    const color=v=>{const span=document.createElement('span');span.style.color=v;root.append(span);const c=getComputedStyle(span).color;span.remove();return c};
    const textColor=getComputedStyle(list).color,panelColor=color('var(--background-primary)'),normalColor=color('var(--text-normal)');
    const parse=v=>(v.match(/[0-9.]+/g)||[]).slice(0,3).map(Number),lum=v=>parse(v).map(n=>{n/=255;return n<=.04045?n/12.92:Math.pow((n+.055)/1.055,2.4)}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0),a=lum(textColor),b=lum(panelColor);
    const before=list.scrollTop;list.scrollTop=list.scrollHeight;const last=options.at(-1),lastVisible=rect(last).bottom<=rect(list).bottom+1&&rect(last).top>=rect(list).top-1;list.scrollTop=before;
    const out={width:innerWidth,count:options.length,hidden:list.hidden,expanded:input.getAttribute('aria-expanded'),native:input.hasAttribute('list')||!!root.querySelector('datalist'),input:rect(input),picker:rect(picker),list:rect(list),toggle:rect(toggle),bodyOverflow:document.documentElement.scrollWidth-innerWidth,rootOverflow:root.scrollWidth-root.clientWidth,scroll:list.scrollHeight>list.clientHeight,lastVisible,panelColor,background:getComputedStyle(list).backgroundColor,normalColor,textColor,contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),font:parseFloat(getComputedStyle(options[0]).fontSize),radius:parseFloat(getComputedStyle(list).borderRadius),border:parseFloat(getComputedStyle(list).borderTopWidth),allRows:[...options].every(e=>rect(e).width>0&&rect(e).left>=rect(list).left&&rect(e).right<=rect(list).right),selected:options.some(e=>e.getAttribute('aria-selected')==='true'),model:input.value};
    parent.postMessage({type:'model-layout',value:out},'*');
   });<\/script>`;
   const child=join(tmp,theme+'-'+width+'-'+state+'-child.html');writePage(child,html.replace('</body>',probe+'</body>'));
   const parent=join(tmp,theme+'-'+width+'-'+state+'.html');writePage(parent,`<!doctype html><body style="margin:0"><pre id="result" style="display:none"></pre><iframe src="${pathToFileURL(child).href}" style="width:${width}px;height:1000px;border:0"></iframe><script>addEventListener('message',e=>{if(e.data?.type==='model-layout')document.getElementById('result').textContent='MODEL_LAYOUT:'+encodeURIComponent(JSON.stringify(e.data.value))})<\/script></body>`);
   const run=spawnSync(browser,['--headless=new','--disable-gpu','--disable-extensions','--no-first-run','--no-default-browser-check','--disable-background-networking','--force-device-scale-factor=1','--window-size=1400,1100','--virtual-time-budget=3000',`--user-data-dir=${join(tmp,theme+'-'+width+'-'+state+'-profile')}`,'--dump-dom',pathToFileURL(parent).href],{encoding:'utf8',timeout:45000,maxBuffer:4*1024*1024});
   assert.equal(run.status,0,run.error||run.stderr?.slice(-500));const found=[...run.stdout.matchAll(/MODEL_LAYOUT:(%7B[^<\s]+)/g)].at(-1);assert(found,'missing model-list metrics');const g=JSON.parse(decodeURIComponent(found[1])),label=theme+' '+width+'px '+state;
   assert.equal(g.width,width,label+' exact viewport');assert.equal(g.count,state==='all'?36:2,label+' full vs typed filtered list');assert(!g.hidden&&g.expanded==='true'&&!g.native,label+' themed expanded combobox');
   assert(g.bodyOverflow<=1&&g.rootOverflow<=1&&g.allRows&&Math.abs(g.picker.width-g.list.width)<=1&&g.input.right<=g.toggle.left+1&&g.list.top>=g.input.bottom,label+' list/input geometry '+JSON.stringify(g));
   assert(g.lastVisible&&(state!=='all'||(g.scroll&&g.list.height<=182)),label+' all models reachable by internal scrolling');assert.equal(g.background,g.panelColor,label+' theme background');assert.equal(g.textColor,g.normalColor,label+' theme text');assert(g.contrast>=DESIGN.minContrast&&g.font>=DESIGN.minFontPx&&g.radius>0&&g.border>0,label+' readable theme surface');assert.equal(g.model,state==='all'?'deepseek-flash':'deepseek',label+' current input preserved');
   console.log('PASS model list native layout: '+label+', complete/filtered models, theme colors, internal scroll, and no overflow');
  }
 } finally {const owner=realpathSync(tmpdir()),target=realpathSync(tmp),child=relative(owner,target);assert(child&&!child.startsWith('..')&&!isAbsolute(child)&&dirname(child)==='.'&&basename(child).startsWith('lubi-model-layout-'),'cleanup stays in owned temp directory');rmSync(target,{recursive:true,force:true});}
}
