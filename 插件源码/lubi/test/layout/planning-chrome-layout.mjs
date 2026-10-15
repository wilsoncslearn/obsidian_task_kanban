// Native regression: short/long month contents must not move the existing sidebar.
// Uses production-rendered synthetic HTML; never reads a real Vault.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdtempSync,readFileSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,relative,isAbsolute,basename} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import { findBrowser } from "../helpers/browser.mjs";
import { writePage } from "../helpers/page.mjs";
const project=dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const browser = findBrowser();
if(!browser){if(process.env.LUBI_REQUIRE_BROWSER==='1')throw new Error('Native browser required for planning scroll stability');console.log('SKIP planning scroll stability: browser unavailable');}
else {
 const tmp=mkdtempSync(join(tmpdir(),'lubi-planning-chrome-'));
 try {
  for(const theme of ['light','dark']){
   const html=readFileSync(join(project,'preview',theme==='dark'?'dark':'','planning-calendar-month.html'),'utf8');
   const probe=`<script>addEventListener('load',()=>{
    const root=document.querySelector('.lubi-root'),body=root.querySelector('.lubi-body'),side=root.querySelector('.lubi-task-lists');
    root.style.height='1300px';root.style.setProperty('--lubi-panel-height','1300px');
    side.querySelectorAll('.lubi-task').forEach((e,i)=>{if(i>=2)e.remove()});
    root.querySelectorAll('.lubi-month-task').forEach((e,i)=>{if(i>=2)e.remove()});
    const measure=()=>{const r=side.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,scroll:body.scrollHeight>body.clientHeight,client:body.clientWidth,gutter:getComputedStyle(body).scrollbarGutter}};
    // New overview/time cards increase natural height; derive both overflow states rather than assuming old pixels.
    const enough=Math.ceil(body.scrollHeight+root.querySelector('.lubi-topbar').offsetHeight+160);root.style.height=enough+'px';root.style.setProperty('--lubi-panel-height',enough+'px');
    const short=measure();side.style.minHeight=(enough+600)+'px';const tall=measure();side.style.minHeight='';const restored=measure();
    const out=document.createElement('pre');out.textContent='LUBI_CHROME:'+encodeURIComponent(JSON.stringify({short,tall,restored}));document.body.append(out);
   });<\/script>`;
   const file=join(tmp,theme+'.html');writePage(file,html.replace('</body>',probe+'</body>'));
   const run=spawnSync(browser,['--headless=new','--disable-gpu','--disable-extensions','--no-first-run','--no-default-browser-check','--disable-background-networking','--force-device-scale-factor=1','--window-size=1400,1100','--virtual-time-budget=4000',`--user-data-dir=${join(tmp,theme+'-profile')}`,'--dump-dom',pathToFileURL(file).href],{encoding:'utf8',timeout:45000,maxBuffer:4*1024*1024});
   assert.equal(run.status,0,run.error||run.stderr?.slice(-500));const found=[...run.stdout.matchAll(/LUBI_CHROME:(%7B[^<\s]+)/g)].at(-1);assert(found,'missing scroll-stability metrics');
   const g=JSON.parse(decodeURIComponent(found[1]));assert(!g.short.scroll&&g.tall.scroll&&!g.restored.scroll,'fixture must exercise actual scrollbar appearance and disappearance: '+JSON.stringify(g));
   for(const state of [g.tall,g.restored]){assert(Math.abs(state.left-g.short.left)<=.5&&Math.abs(state.right-g.short.right)<=.5,theme+' sidebar must not move '+JSON.stringify(g));assert.equal(state.client,g.short.client,'body usable width stays stable');}
   assert.equal(g.short.width,300);console.log('PASS planning scroll stability: '+theme+', short → tall → short without sidebar drift');
  }
 } finally {
  const owner=realpathSync(tmpdir()),target=realpathSync(tmp),child=relative(owner,target);
  assert(child&&!child.startsWith('..')&&!isAbsolute(child)&&dirname(child)==='.'&&basename(child).startsWith('lubi-planning-chrome-'),'cleanup stays within owned test directory');rmSync(target,{recursive:true,force:true});
 }
}
