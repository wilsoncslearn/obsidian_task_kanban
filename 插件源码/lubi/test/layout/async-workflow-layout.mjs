// Native Chromium geometry for actual-bundle, synthetic async-workflow previews.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, isAbsolute, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findBrowser } from "../helpers/browser.mjs";
import { writePage } from "../helpers/page.mjs";
import { DESIGN } from "../helpers/design.mjs";
const project = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const browser = findBrowser();
if (!browser) {
  if (process.env.LUBI_REQUIRE_BROWSER === '1') throw Error('Native browser required for async workflow layout');
  console.log('SKIP async workflow layout: browser unavailable');
} else {
  const generated = spawnSync(process.execPath, ['test/helpers/preview.mjs'], { cwd: project, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(generated.status, 0, generated.stderr + generated.stdout);
  const temporary = mkdtempSync(join(tmpdir(), 'lubi-async-layout-'));
  try {
    for (const theme of ['light', 'dark']) for (const width of [1400, 900, 390, 320]) for (const name of ['async-workflow', 'modal-async']) {
      const source = readFileSync(join(project, 'preview', theme === 'dark' ? 'dark' : '', name + '.html'), 'utf8');
      const native = '<style>.modal{top:16px;max-height:calc(100vh - 32px);display:flex;flex-direction:column}.modal-content{min-height:0;overflow-y:auto}</style>';
      const probe = `<script>addEventListener('load',()=>{(document.fonts?.ready||Promise.resolve()).then(()=>setTimeout(()=>{
        const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
        const modal=document.querySelector('.lubi-task-modal'),queue=document.querySelector('.lubi-attention-card');
        let out={kind:${JSON.stringify(name)},overflow:document.documentElement.scrollWidth-innerWidth};
        if(queue){const card=rect(queue),buttons=[...queue.querySelectorAll('.lubi-execution-actions button')];out={...out,queue:card,count:queue.querySelectorAll('.lubi-execution-item').length,buttons:buttons.map(e=>({box:rect(e),text:e.textContent})),titles:[...queue.querySelectorAll('.lubi-execution-title')].map(rect),first:queue.parentElement.firstElementChild===queue,running:!!document.querySelector('.lubi-background-card'),named:buttons.every(e=>e.textContent.trim()||e.getAttribute('aria-label')||e.getAttribute('aria-labelledby'))};}
        if(modal){const content=modal.querySelector('.modal-content');content.scrollTop=content.scrollHeight;const m=rect(modal),c=rect(content),save=modal.querySelector('[data-actual-action=record]'),complete=modal.querySelector('[data-actual-action=complete]');out={...out,modal:m,inputs:[...content.querySelectorAll('input,select,textarea')].filter(e=>e.getBoundingClientRect().width>0).every(e=>{const r=rect(e);return r.left>=m.left-.5&&r.right<=m.right+.5}),saveReachable:rect(save).top>=c.top-.5&&rect(save).bottom<=c.bottom+.5,completeVisible:!complete.closest('[hidden]')&&rect(complete).width>0&&!complete.checked,actor:modal.querySelector('[data-task-executor]').value,saveText:save.textContent};}
        const result=document.createElement('pre');result.textContent='LUBI_ASYNC:'+encodeURIComponent(JSON.stringify(out));document.body.append(result);
      },0));});<\/script>`;
      const file = join(temporary, `${theme}-${width}-${name}.html`);
      writePage(file, source.replace('</head>', native + '</head>').replace('</body>', probe + '</body>'), 'utf8');
      const result = spawnSync(browser, ['--headless=new', '--disable-gpu', '--disable-extensions', '--disable-background-networking', '--no-first-run', '--no-default-browser-check', '--force-device-scale-factor=1', `--window-size=${width},900`, '--virtual-time-budget=3500', `--user-data-dir=${join(temporary, `profile-${theme}-${width}-${name}`)}`, '--dump-dom', pathToFileURL(file).href], { encoding: 'utf8', timeout: 45000, maxBuffer: 8 * 1024 * 1024 });
      assert.equal(result.status, 0, result.error || result.stderr?.slice(-500));
      const found = [...result.stdout.matchAll(/LUBI_ASYNC:(%7B[^<\s]+)/g)].at(-1);
      assert(found, 'Missing async layout metrics');
      const metrics = JSON.parse(decodeURIComponent(found[1])), label = `${theme} ${width}px ${name}`;
      assert(metrics.overflow <= 1, label + ' horizontal overflow: ' + JSON.stringify(metrics));
      if (name === 'async-workflow') {
        assert(metrics.first && metrics.count === 1 && metrics.running && metrics.named, label + ' global attention/running queues');
        assert(metrics.buttons.length === 4, label + ' acceptance, rework, recording and follow-up');
        assert(metrics.buttons.every(({ box }) => box.left >= metrics.queue.left - .5 && box.right <= metrics.queue.right + .5 && box.height >= DESIGN.actionHeightPx), label + ' reachable, wrapped review actions: ' + JSON.stringify(metrics));
        assert(metrics.titles.every(box => box.right <= metrics.queue.right + .5), label + ' long task titles stay contained');
      } else assert(metrics.inputs && metrics.saveReachable && metrics.completeVisible && metrics.actor === 'background' && metrics.saveText.includes('保存用时'), label + ' explicit record/complete actions and accessible form: ' + JSON.stringify(metrics));
      console.log('PASS async native layout: ' + label);
    }
  } finally {
    const owner = realpathSync(tmpdir()), target = realpathSync(temporary), child = relative(owner, target);
    assert(child && !child.startsWith('..') && !isAbsolute(child) && dirname(child) === '.' && basename(child).startsWith('lubi-async-layout-'));
    rmSync(target, { recursive: true, force: true });
  }
}
