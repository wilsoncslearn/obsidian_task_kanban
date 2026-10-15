// Native browser checks on the synthetic production-rendered form.
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
if(!browser){if(process.env.LUBI_REQUIRE_BROWSER==='1')throw Error('Native browser required for compact task form');console.log('SKIP compact task form: browser unavailable');}
else {
 const tmp=mkdtempSync(join(tmpdir(),'lubi-compact-task-'));
 try {
  for(const theme of ['light','dark'])for(const [width,height]of [[1400,900],[575,950],[1000,800],[390,844],[320,700],[575,500]]){
   const html=readFileSync(join(project,'preview',theme==='dark'?'dark':'','modal-new.html'),'utf8');
   // Stand-in for Obsidian's viewport-constrained modal/content scrolling, not hidden overflow.
   const native=`<style>.modal{top:16px;max-height:calc(100vh - 32px);display:flex;flex-direction:column}.modal-content{min-height:0;overflow-y:auto}</style>`;
   const probe=`<script>addEventListener('load',()=>{
    const modal=document.querySelector('.lubi-task-modal'),content=modal.querySelector('.modal-content'),save=content.querySelector('.mod-cta');
    const r=e=>{const x=e.getBoundingClientRect();return {top:x.top,bottom:x.bottom,left:x.left,right:x.right,height:x.height}};
    const initial={viewportHeight:innerHeight,modal:r(modal),save:r(save),scroll:content.scrollHeight>content.clientHeight+1,accent:getComputedStyle(modal,'::before').content,inputs:[...content.querySelectorAll('input,select')].filter(e=>r(e).right>r(e).left).every(e=>r(e).left>=r(modal).left&&r(e).right<=r(modal).right),overflow:document.documentElement.scrollWidth-innerWidth};
    content.scrollTop=content.scrollHeight;initial.saveReachable=r(save).bottom<=r(content).bottom+1&&r(save).top>=r(content).top-1;
    const out=document.createElement('pre');out.textContent='LUBI_COMPACT:'+encodeURIComponent(JSON.stringify(initial));document.body.append(out);
   });<\/script>`;
   const file=join(tmp,`${theme}-${width}-${height}.html`);writePage(file,html.replace('</head>',native+'</head>').replace('</body>',probe+'</body>'));
   const run=spawnSync(browser,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--force-device-scale-factor=1',`--window-size=${width},${height}`,'--virtual-time-budget=3000',`--user-data-dir=${join(tmp,`${theme}-${width}-${height}-profile`)}`,'--dump-dom',pathToFileURL(file).href],{encoding:'utf8',timeout:45000,maxBuffer:4*1024*1024});
   assert.equal(run.status,0,run.error||run.stderr?.slice(-500));const found=[...run.stdout.matchAll(/LUBI_COMPACT:(%7B[^<\s]+)/g)].at(-1);assert(found,'missing compact form metrics');const g=JSON.parse(decodeURIComponent(found[1]));
   assert(g.accent==='none'&&g.inputs&&g.overflow<=1&&g.modal.top>=0&&g.modal.bottom<=g.viewportHeight&&g.saveReachable,`${theme} ${width}x${height} visible form and reachable save: ${JSON.stringify(g)}`);
   if(width>=540&&height>=800)assert(!g.scroll&&g.save.bottom<=g.viewportHeight,`${theme} ${width}x${height} default task fits without scrolling: ${JSON.stringify(g)}`);
   if(height===500)assert(g.scroll,'short screen must retain actual scrolling, not crop controls');
   console.log(`PASS compact task form: ${theme} ${width}x${height}, scroll=${g.scroll}, no accent, save reachable`);
  }
 }finally{const owner=realpathSync(tmpdir()),target=realpathSync(tmp),child=relative(owner,target);assert(child&&!child.startsWith('..')&&!isAbsolute(child)&&dirname(child)==='.'&&basename(child).startsWith('lubi-compact-task-'));rmSync(target,{recursive:true,force:true});}
}
