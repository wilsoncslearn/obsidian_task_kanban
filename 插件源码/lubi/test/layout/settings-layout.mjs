// Real Chromium checks for settings only. Synthetic preview; never reads a real Vault or browser profile.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { findBrowser } from "../helpers/browser.mjs";
import { writePage } from "../helpers/page.mjs";
import { DESIGN } from "../helpers/design.mjs";
const project = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const browser = findBrowser();
if (!browser) {
  if (process.env.LUBI_REQUIRE_BROWSER === "1") throw new Error("Chrome/Edge is required for settings layout regression");
  console.log("SKIP settings geometry: install Chrome/Edge or set LUBI_BROWSER");
} else {
  const temp = mkdtempSync(join(tmpdir(), "lubi-settings-layout-"));
  const probe = String.raw`<pre id="settings-result"></pre><script>
  (() => {
    const root = document.querySelector('.lubi-settings'), ai = root.querySelector('.lubi-settings-ai');
    root.classList.add('vertical-tab-content');
    if (document.documentElement.dataset.expanded === 'true') ai.open = true;
    const updateButton=root.querySelector('[data-lubi-update]'),updateStatus=root.querySelector('[data-lubi-update-status]'),updateLink=root.querySelector('[data-lubi-update-link]');
    const installButton=root.querySelector('[data-lubi-install]');installButton.hidden=false;installButton.textContent='更新至 1.8.0';
    updateStatus.textContent='发现新版本 1.8.0。保留 data.json、任务和日记；安装前校验最低 Obsidian 版本要求和 SHA-256，旧文件备份到 Vault 外，失败时回滚。点击更新并确认即可安装，安装后重启生效。';
    updateLink.textContent='下载新版本 1.8.0';
    updateStatus.textContent+=' 旧文件备份：/synthetic-temporary-directory/'+ 'unbroken-synthetic-backup-name'.repeat(15);
    const prompt=root.querySelector('.lubi-json-prompt'),copy=[...root.querySelectorAll('.lubi-settings-json-import button')].find(button=>button.textContent==='复制系统提示词');
    const promptRect=prompt.getBoundingClientRect(),rootRect=root.getBoundingClientRect();
    const out = { update:{button:!!updateButton&&updateButton.getBoundingClientRect().width>0, install:!!installButton&&installButton.getBoundingClientRect().width>0&&installButton.getBoundingClientRect().right<=rootRect.right+1, statusInside:updateStatus.getBoundingClientRect().right<=rootRect.right+1, linkInside:updateLink.getBoundingClientRect().right<=rootRect.right+1, live:updateStatus.getAttribute("aria-live")==="polite"}, prompt:{readOnly:prompt.readOnly,visible:promptRect.width>0&&promptRect.height>=180,inside:promptRect.left>=rootRect.left&&promptRect.right<=rootRect.right,hasFormat:prompt.value.includes('tasks')&&prompt.value.includes('subtasks'),copy:!!copy&&copy.getBoundingClientRect().width>0}, overflow: root.scrollWidth - root.clientWidth, bodyOverflow: document.body.scrollWidth - innerWidth, aiOpen:ai.open, modelInputs:root.querySelectorAll('[data-setting=ai-model]').length, aiDropdowns:[...ai.querySelectorAll('select')].filter(el=>!el.closest('[data-setting=ai-keychain]')).length, labels:[], minFont:99, contrast:[], effects:[] };
    const rect = el => el.getBoundingClientRect();
    for (const group of root.querySelectorAll('.lubi-category-controls')) {
      const cells = [...group.children].map(rect);
      const header = root.querySelector('.lubi-category-header'), compact = rect(header).height > 0;
      if (compact && rect(group.closest('.lubi-category-row')).height > LUBI_DESIGN.compactSettingRowPx) out.labels.push('desktop category row is not compact');
      if (compact && Math.max(...cells.map(box=>box.top))-Math.min(...cells.map(box=>box.top))>6) out.labels.push('desktop category controls do not share a row');
      if (compact && [...group.querySelectorAll('.lubi-settings-field-label')].some(label=>rect(label).height>0)) out.labels.push('desktop category captions repeat the header');
      for (const field of group.querySelectorAll('.lubi-settings-field')) {
        const caption = field.querySelector('.lubi-settings-field-label'), control = field.querySelector('input,select');
        if (getComputedStyle(caption).textAlign !== 'left') out.labels.push('category caption inherits right alignment');
        if (control && Math.abs(rect(control).width - rect(field).width) > 2) out.labels.push('category control not filling its labeled field');
      }
      for (let i=0;i<cells.length;i++) for(let j=i+1;j<cells.length;j++) {
        if (Math.min(cells[i].right,cells[j].right)-Math.max(cells[i].left,cells[j].left)>1 && Math.min(cells[i].bottom,cells[j].bottom)-Math.max(cells[i].top,cells[j].top)>1) out.labels.push('overlapping category fields');
      }
      for (const el of group.querySelectorAll('input,select')) if(rect(el).right>rect(group).right+1) out.labels.push('category control overflow');
    }
    for (const info of root.querySelectorAll('.setting-item-info')) {
      const item = info.closest('.setting-item');
      if (!rect(info).width || item.classList.contains('lubi-setting-stacked')) continue;
      const description = info.querySelector('.setting-item-description');
      if (description?.textContent && rect(description).width < rect(info).width - 2) out.labels.push('description artificially squeezed');
    }
    if (ai.open) {
      const model=root.querySelector('[data-setting=ai-model]'), key=root.querySelector('[data-setting=ai-key]');
      const controls=ai.querySelectorAll('.lubi-setting-stacked input');
      if (key.type!=='password') out.labels.push('key not masked');
      for (const input of controls) if(rect(input.closest('.lubi-model-picker')||input).width<rect(input.closest('.setting-item')).width-2) out.labels.push('AI fields not full width');
    }
    const parse = text => { const m=(text.match(/[\d.]+/g)||[]).map(Number); if(text.startsWith('color(')){const a=m.slice(0,3).map(x=>x*255);if(m.length>3)a.push(m[3]);return a;} return m; };
    const luminance = values => values.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4)}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
    const background = el => {while(el){const c=parse(getComputedStyle(el).backgroundColor);if(c.length>=3&&(c.length<4||c[3]>.95))return c;el=el.parentElement;}return [255,255,255];};
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    while(walker.nextNode()){
      const node=walker.currentNode,el=node.parentElement;if(!node.nodeValue.trim()||!el||el.closest('.lubi-sr-only,datalist'))continue;
      const style=getComputedStyle(el),box=rect(el);if(!box.width||!box.height||style.display==='none'||style.visibility==='hidden'||el.closest('[hidden]'))continue;
      out.minFont=Math.min(out.minFont,parseFloat(style.fontSize));
      const a=luminance(parse(style.color)),b=luminance(background(el)),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
      if(ratio<LUBI_DESIGN.minContrast)out.contrast.push(ratio.toFixed(2)+' '+el.className+' '+node.nodeValue.trim().slice(0,20));
    }
    for(const el of root.querySelectorAll('*')) if(getComputedStyle(el).backgroundImage.includes('gradient')||(getComputedStyle(el).backdropFilter&&getComputedStyle(el).backdropFilter!=='none'))out.effects.push(el.className);
    document.getElementById('settings-result').textContent='SETTINGS_LAYOUT:'+encodeURIComponent(JSON.stringify(out));
  })();
  </script>`;
  const nativeRules = "<style>\n/* Emulate the native setting rules after plugin CSS: inherited right alignment and auto-sized controls. */\n.vertical-tab-content .setting-item-control { flex: 1; text-align: right; }\n.vertical-tab-content .setting-item-control label { display: block; }\n.vertical-tab-content .setting-item-control input[type=\"text\"] { width: 180px; }\n.vertical-tab-content .setting-item-control select { width: auto; }\n.vertical-tab-content .setting-item-info { width: 160px; max-width: 200px; flex: 0 1 auto; }\n.vertical-tab-content .setting-item-description { max-width: 160px; }\n</style>";
  try {
    for (const theme of ["light","dark"]) for (const width of [850,665,600,390,320]) for(const expanded of [false,true]) {
      const src=join(project,"preview",theme==="dark"?"dark":"","settings.html");
      assert(existsSync(src),"settings preview must be generated by topbar layout/preview first");
      const html=readFileSync(src,"utf8").replace('<html>','<html data-expanded="'+expanded+'">').replace('</head>',nativeRules+'</head>').replace('</body>',probe+'</body>');
      const file=join(temp,theme+'-'+width+'-'+expanded+'.html');writePage(file,html,"utf8");
      const result=spawnSync(browser,["--headless=new","--disable-gpu","--disable-extensions","--no-first-run","--no-default-browser-check","--disable-background-networking","--hide-scrollbars","--window-size="+width+",1000","--user-data-dir="+join(temp,theme+'-'+width+'-'+expanded),"--dump-dom",pathToFileURL(file).href],{encoding:"utf8",timeout:30000,maxBuffer:16*1024*1024});
      assert.equal(result.status,0,result.error?.message||result.stderr?.slice(-500));
      const matches=[...result.stdout.matchAll(/SETTINGS_LAYOUT:([A-Za-z0-9%._~-]+)/g)];assert(matches.length,'browser did not return settings geometry');
      const out=JSON.parse(decodeURIComponent(matches.at(-1)[1]));
      assert(out.update.button&&out.update.install&&out.update.statusInside&&out.update.linkInside&&out.update.live,'update controls, instructions and live status fit settings');
      assert(out.prompt.readOnly&&out.prompt.visible&&out.prompt.inside&&out.prompt.hasFormat&&out.prompt.copy,"copyable JSON prompt fits settings");
      assert(out.overflow<=1 && out.bodyOverflow<=1,theme+' '+width+': horizontal overflow '+JSON.stringify(out));
      assert.equal(out.aiOpen,expanded,'AI default/expanded state');assert.equal(out.modelInputs,1,'single model input');assert.equal(out.aiDropdowns,0,'no duplicate model selector');
      assert.deepEqual(out.labels,[],theme+' '+width+': controls overlap or too narrow');assert(out.minFont>=DESIGN.minFontPx,'settings font below 11px');assert.deepEqual(out.contrast,[],theme+' '+width+': insufficient contrast '+out.contrast.join('; '));assert.deepEqual(out.effects,[],'settings has decorative effects');
      console.log('ok   settings '+theme+' '+width+'px '+(expanded?'AI expanded':'AI folded')+': labels, controls, contrast and width');
    }
  } finally {try{rmSync(temp,{recursive:true,force:true});}catch{ /* Temporary Chrome profile may be briefly held on Windows. */ }}
}
