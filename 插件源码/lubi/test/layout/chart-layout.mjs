// Browser geometry regression for the review chart. Uses synthetic markup/data only.
// No personal records, vault files, or browser profiles are read.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { findBrowser } from "../helpers/browser.mjs";
import { writePage } from "../helpers/page.mjs";

const project = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const pluginCss = readFileSync(join(project, "styles.css"), "utf8");
const browser = findBrowser();

if (!browser) {
  if (process.env.LUBI_REQUIRE_BROWSER === "1") throw new Error("Chrome/Edge is required for chart layout regression");
  console.log("SKIP chart geometry: install Chrome/Edge or set LUBI_BROWSER to run browser checks");
} else {
  const themeCss = `
    :root { --input-height: 30px; --radius-s: 4px; --background-primary: #fff;
      --background-secondary: #eee; --background-modifier-border: #ddd;
      --text-normal: #222; --text-muted: #777; --interactive-accent: #895fff;
      --color-blue: #06c; --lubi-border: #ddd; }
    body.theme-light button:not(.clickable-icon),
    body.theme-dark button:not(.clickable-icon) {
      height: var(--input-height); min-height: var(--input-height);
      padding: 0 12px; border: 1px solid #ddd; box-shadow: 0 1px 2px #ddd;
      background: #fff;
    }
  `;
  const tmp = mkdtempSync(join(tmpdir(), "lubi-chart-layout-"));
  try {
    const cases = [
      { width: 360, theme: "light", themeAfterPlugin: false },
      { width: 560, theme: "dark", themeAfterPlugin: true },
      { width: 1400, theme: "light", themeAfterPlugin: true },
    ];
    for (const [index, item] of cases.entries()) {
      const styles = item.themeAfterPlugin
        ? `<style>${pluginCss}</style><style>${themeCss}</style>`
        : `<style>${themeCss}</style><style>${pluginCss}</style>`;
      const bars = [18, 786, 90].map((minutes) => `
        <button type="button" class="lubi-bar-col">
          <div class="lubi-bar-stack" style="height:${(minutes / 1440) * 100}%">
            <div class="lubi-bar-seg" style="flex-basis:100%;background:#06c"></div>
            <div class="lubi-bar-val">${(minutes / 60).toFixed(1)}h</div>
          </div>
          <div class="lubi-bar-label">9/24</div>
        </button>`).join("");
      const page = `<!doctype html><meta charset="utf-8">${styles}
        <body class="theme-${item.theme}">
          <div class="lubi-root" style="width:${item.width}px;height:420px">
            <div class="lubi-page"><div class="lubi-review"><div class="lubi-card lubi-chart-card">
              <div class="lubi-panel-head">每日记录时长</div>
              <div class="lubi-chart"><div class="lubi-chart-grid"></div>
                <div class="lubi-bars">${bars}</div>
              </div>
            </div></div></div>
          </div>
          <pre id="result"></pre>
          <script>
            const grid = document.querySelector('.lubi-chart-grid').getBoundingClientRect();
            const bar = document.querySelectorAll('.lubi-bar-col')[1];
            const column = bar.getBoundingClientRect();
            const stack = bar.querySelector('.lubi-bar-stack').getBoundingClientRect();
            const label = bar.querySelector('.lubi-bar-label').getBoundingClientRect();
            document.getElementById('result').textContent =
              'LUBI_GEOMETRY:' + encodeURIComponent(JSON.stringify({
                gridH: grid.height, gridBottom: grid.bottom, columnH: column.height,
                columnBottom: column.bottom, stackH: stack.height, stackBottom: stack.bottom,
                labelTop: label.top, computedColumnHeight: getComputedStyle(bar).height,
                border: getComputedStyle(bar).borderTopWidth,
                padding: getComputedStyle(bar).paddingTop,
                shadow: getComputedStyle(bar).boxShadow,
              }));
          </script>
        </body>`;
      const file = join(tmp, `chart-${index}.html`);
      writePage(file, page, "utf8");
      const result = spawnSync(browser, [
        "--headless=new", "--disable-gpu", "--disable-extensions", "--no-first-run",
        "--no-default-browser-check", "--disable-background-networking",
        `--user-data-dir=${join(tmp, `profile-${index}`)}`,
        "--dump-dom", pathToFileURL(file).href,
      ], { encoding: "utf8", timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
      assert.equal(result.status, 0, `headless browser failed: ${result.error || result.stderr?.slice(-500)}`);
      const matches = [...result.stdout.matchAll(/LUBI_GEOMETRY:([A-Za-z0-9%._~-]+)/g)];
      assert(matches.length > 0, "browser did not return chart geometry");
      const g = JSON.parse(decodeURIComponent(matches[matches.length - 1][1]));
      assert(g.gridH > 180, `chart grid missing: ${JSON.stringify(g)}`);
      assert(Math.abs(g.columnH - g.gridH) < 2, `bar button must fill chart height: ${JSON.stringify(g)}`);
      assert(Math.abs(g.columnBottom - g.gridBottom) < 2, `bar column must end at zero baseline: ${JSON.stringify(g)}`);
      assert(Math.abs(g.stackH / g.gridH - 786 / 1440) < 0.02, `13.1h bar must occupy ~55% of 24h grid: ${JSON.stringify(g)}`);
      assert(Math.abs(g.stackBottom - g.gridBottom) < 2, `bar must touch zero baseline: ${JSON.stringify(g)}`);
      assert(g.labelTop >= g.gridBottom - 2 && g.labelTop <= g.gridBottom + 22, `date must sit below baseline: ${JSON.stringify(g)}`);
      assert.equal(g.border, "0px", `theme button border must not frame each bar: ${JSON.stringify(g)}`);
      assert.equal(g.padding, "0px", `theme button padding must not distort chart: ${JSON.stringify(g)}`);
      assert.equal(g.shadow, "none", `theme button shadow must not frame each bar: ${JSON.stringify(g)}`);
      console.log(`ok   review chart geometry ${item.width}px ${item.theme} themeAfter=${item.themeAfterPlugin}: ${Math.round(g.stackH)}px / ${Math.round(g.gridH)}px`);
    }
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* Chrome may briefly hold its temp profile on Windows. */ }
  }
}
