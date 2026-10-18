// Visual regression on production-rendered synthetic data, never the real Vault.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { findBrowser } from '../helpers/browser.mjs';
import { writePage } from '../helpers/page.mjs';
const browser = findBrowser();
if (!browser) {
  if (process.env.LUBI_REQUIRE_BROWSER === '1') throw Error('Browser required for time-card polish');
  console.log('SKIP time-card polish: browser unavailable');
} else {
  const temporary = mkdtempSync(join(tmpdir(), 'lubi-time-polish-'));
  try {
    for (const theme of ['light', 'dark']) for (const width of [390, 1400]) {
      const html = readFileSync(new URL(`../../preview/${theme === 'dark' ? 'dark/' : ''}planning-calendar-day.html`, import.meta.url), 'utf8');
      const probe = `<script>addEventListener('load',()=>{
        const root=document.querySelector('.lubi-root'),style=e=>getComputedStyle(e);
        const nav=root.querySelector('.lubi-planning-nav'),entries=[...root.querySelectorAll('.lubi-personal-time-entry')];
        const blocks=[...root.querySelectorAll('.lubi-block:not(.lubi-block-ghost)')];
        const result={viewport:innerWidth,navRadius:style(nav).borderRadius,entries:entries.map(e=>({border:style(e).borderTopColor,radius:style(e).borderRadius,background:style(e).backgroundColor,canvas:style(root).backgroundColor,inside:[...e.children].every(c=>c.getBoundingClientRect().right<=e.getBoundingClientRect().right+1)})),blocks:blocks.map(e=>({background:style(e).backgroundColor,canvas:style(root).backgroundColor,border:style(e).borderTopWidth,stripe:getComputedStyle(e,'::before').backgroundColor})),overflow:root.scrollWidth-root.clientWidth};
        parent.postMessage('LUBI_POLISH:'+encodeURIComponent(JSON.stringify(result)),'*');
      });<\/script>`;
      const file = join(temporary, `${theme}-${width}.html`);
      const source = html.replace('</body>', probe + '</body>').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
      writePage(file, `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}iframe{display:block;border:0;width:${width}px;height:1000px}</style><script>addEventListener('message',e=>{if(typeof e.data==='string'&&e.data.startsWith('LUBI_POLISH:')){const p=document.createElement('pre');p.textContent=e.data;document.body.append(p);}});</script></head><body><iframe srcdoc="${source}"></iframe></body></html>`);
      const run = spawnSync(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--disable-extensions', '--disable-background-networking', `--window-size=${width},1000`, '--virtual-time-budget=2500', `--user-data-dir=${join(temporary, `${theme}-${width}-profile`)}`, '--dump-dom', pathToFileURL(file).href], { encoding: 'utf8', timeout: 45000, maxBuffer: 10 * 1024 * 1024 });
      assert.equal(run.status, 0, run.error || run.stderr?.slice(-500));
      const match = [...run.stdout.matchAll(/LUBI_POLISH:(%7B[^<\s]+)/g)].at(-1);
      assert(match, 'Missing polish metrics');
      const metrics = JSON.parse(decodeURIComponent(match[1]));
      assert.equal(metrics.viewport, width, 'Test actual pane width');
      assert.equal(metrics.navRadius, '12px');
      assert(metrics.entries.length > 0 && metrics.blocks.length > 0, 'Fixture must contain time entries and timeline blocks');
      assert(metrics.entries.every(e => e.radius === '8px' && e.background !== e.canvas && e.inside), JSON.stringify(metrics));
      assert(metrics.blocks.every(e => e.border === '1px' && e.background !== e.canvas), JSON.stringify(metrics));
      assert(metrics.overflow <= 1, 'No page overflow');
      console.log(`PASS time-card polish: ${theme} ${width}px`);
    }
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
