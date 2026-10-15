// Browser layout + button-state regression. Synthetic tasks only; no user vault is accessed.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { findBrowser } from "../helpers/browser.mjs";
import { writePage } from "../helpers/page.mjs";

const project = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const pluginCss = readFileSync(process.env.LUBI_TEST_CSS || join(project, "styles.css"), "utf8");
const browser = findBrowser();

if (!browser) {
  if (process.env.LUBI_REQUIRE_BROWSER === "1") throw new Error("Chrome/Edge is required for task UI layout regression");
  console.log("SKIP task UI geometry: install Chrome/Edge or set LUBI_BROWSER");
} else {
  const themeCss = `
    body { margin: 0; font: 14px system-ui, sans-serif; --radius-s: 5px;
      --font-ui-small: 12px; --font-ui-smaller: 11px; --font-ui-medium: 14px;
      --background-primary: #fff; --background-secondary: #f4f5f7; --background-modifier-hover: #e9ebf2;
      --background-modifier-border: #cdd0db; --text-normal: #242632; --text-muted: #606575;
      --text-faint: #74798a; --text-on-accent: #fff; --text-accent: #6652d0;
      --interactive-accent: #6652d0; --color-blue: #2361c8; --color-green: #15803d;
      --color-orange: #bd660c; --text-error: #b62f38; }
    body.theme-dark { --background-primary: #20222b; --background-secondary: #2b2e39;
      --background-modifier-hover: #373b4b; --background-modifier-border: #5a5e70;
      --text-normal: #f4f4f6; --text-muted: #c1c2cd; --text-on-accent: #fff;
      --text-accent: #b6a8ff; --interactive-accent: #9888ed; --color-blue: #78b5fc;
      --color-green: #80d8aa; --color-orange: #f2ad62; }
    body.theme-light button:not(.clickable-icon), body.theme-dark button:not(.clickable-icon) {
      height: 30px; min-height: 30px; padding: 0 12px; border: 1px solid #a0a2ad;
      border-radius: 6px; background: var(--background-primary); color: var(--text-normal);
      box-shadow: 0 2px 4px #8888; white-space: nowrap;
    }
  `;
  const longPath = "学习数学分析 / 学习极限 / 学习三明治定理 / 学习三角函数与指数函数的极限";
  const longTitle = "梳理三角函数与指数函数极限的详细推导过程并完成习题";
  const longChip = "学习指数函数与对数函数的极限并整理错题";
  const tmp = mkdtempSync(join(tmpdir(), "lubi-task-ui-"));
  try {
    const cases = [
      { width: 1480, theme: "light", themeAfterPlugin: true },
      { width: 1180, theme: "dark", themeAfterPlugin: true },
      { width: 940, theme: "light", themeAfterPlugin: false },
      { width: 760, theme: "dark", themeAfterPlugin: true },
      { width: 390, theme: "light", themeAfterPlugin: true },
      { width: 320, theme: "dark", themeAfterPlugin: true },
      { width: 390, theme: "light", themeAfterPlugin: true, coarse: true },
      { width: 320, theme: "dark", themeAfterPlugin: true, coarse: true },
    ];
    for (const [index, item] of cases.entries()) {
      const css = item.coarse ? pluginCss.replaceAll("@media (pointer: coarse)", "@media all") : pluginCss;
      const styles = item.themeAfterPlugin
        ? `<style>${css}</style><style>${themeCss}</style>`
        : `<style>${themeCss}</style><style>${css}</style>`;
      const days = Array.from({ length: 7 }, (_, i) => `<div class="lubi-week-day ${i === 4 ? "is-selected" : ""}">
        <button type="button" class="lubi-week-day-button" ${i === 4 ? 'aria-current="date"' : ""}>
          <span class="lubi-week-dow">周${"一二三四五六日"[i]}</span><span class="lubi-week-date">${20 + i}</span>
        </button>
        <div class="lubi-allday">${i === 4 ? `<button type="button" class="lubi-allday-chip" style="--chip:#5d82ca" title="${longChip}" id="longChip">${longChip}</button><button type="button" class="lubi-allday-chip" style="--chip:#5d82ca">另一项全天安排</button>` : ""}</div>
      </div>`).join("");
      const page = `<!doctype html><meta charset="utf-8">${styles}<body class="theme-${item.theme}">
        <div class="lubi-root" style="width:${item.width}px;height:1100px">
          <div class="lubi-topbar"><div class="lubi-seg lubi-topbar-tabs">
            <button class="lubi-seg-item" id="reviewTab" aria-pressed="false">回顾</button>
            <button class="lubi-seg-item" id="taskTab" aria-pressed="true">计划</button>
          </div><button class="lubi-date-label is-today" id="dateLabel">9月25日</button></div>
          <div class="lubi-body"><div class="lubi-page"><div class="lubi-tasks">
            <div class="lubi-tasks-top"><div class="lubi-tasks-left"><div class="lubi-card" id="leftCard">
              <div class="lubi-panel-head"><h3 class="lubi-panel-title">今日任务</h3></div>
              <div class="lubi-task-list"><div class="lubi-task-group">
                <button type="button" class="lubi-btn lubi-task-group-title" id="groupPath"><span>${longPath}</span></button>
                <div class="lubi-task"><input type="checkbox"><div class="lubi-task-body">
                  <button type="button" class="lubi-task-title lubi-task-title-button" id="taskTitle"><span class="lubi-dot" style="--dot:#5d82ca"></span><span class="lubi-task-title-text">${longTitle}</span></button>
                  <div class="lubi-task-meta" id="taskMeta">${longPath} · 09:00 · 1h</div>
                </div><div class="lubi-task-actions" id="taskActions"><button type="button" class="lubi-btn lubi-btn-sm lubi-task-start" aria-label="记本人用时"><span>记用时</span></button></div></div>
              </div></div></div><div class="lubi-agenda-host"><div class="lubi-card lubi-agenda-card" id="agenda">窄屏日程</div></div></div>
              <div class="lubi-card lubi-week-card" id="weekCard"><div class="lubi-panel-head">周日程</div>
                <div class="lubi-week"><div class="lubi-week-corner"></div>${days}</div>
              </div></div>
          </div></div></div></div>
        <div class="lubi-modal lubi-task-modal" style="width:${Math.min(item.width - 12, 480)}px;--chip:#5d82ca">
          <div class="lubi-seg lubi-status-seg" role="group" aria-label="任务状态">
            <button class="lubi-seg-item" data-task-status="todo" aria-pressed="true"><span class="lubi-status-check">✓</span>待办</button>
            <button class="lubi-seg-item" data-task-status="doing" aria-pressed="false"><span class="lubi-status-check">✓</span>进行中</button>
            <button class="lubi-seg-item" data-task-status="done" aria-pressed="false"><span class="lubi-status-check">✓</span>已完成</button>
          </div><button class="lubi-quick-chip lubi-quick-chip-warn" aria-pressed="false">受阻</button>
          <div class="lubi-cat-picker"><button class="lubi-cat-option" style="--chip:#5d82ca" aria-pressed="true">学习</button><button class="lubi-cat-option" aria-pressed="false">日常</button></div>
          <div class="lubi-extras-toggles">${["项目","任务跨度","状态","备注"].map(label=>`<button class="lubi-ghost-btn">${label}</button>`).join("")}</div><div class="lubi-modal-actions"><button class="lubi-btn lubi-btn-ghost">取消</button><button class="lubi-btn mod-cta" id="save">保存</button></div>
        </div>
        <div class="lubi-notice"><button class="lubi-notice-btn" id="undo">撤销</button></div>
        <pre id="result"></pre><script>
          const $ = (s) => document.querySelector(s);
          const metrics = (el) => { const r = el.getBoundingClientRect(); const c = getComputedStyle(el);
            return { x:r.x, right:r.right, top:r.top, bottom:r.bottom, w:r.width, h:r.height,
              scrollW:el.scrollWidth, clientW:el.clientWidth, scrollH:el.scrollHeight, clientH:el.clientHeight,
              whiteSpace:c.whiteSpace, shadow:c.boxShadow, border:c.borderTopColor, borderStyle:c.borderTopStyle, borderWidth:c.borderTopWidth, background:c.backgroundColor,
              color:c.color, visibility:c.visibility, minHeight:c.minHeight, padLeft:c.paddingLeft }; };
          const before = {
            selected: metrics($('.lubi-status-seg [data-task-status="todo"]')),
            idle: metrics($('.lubi-status-seg [data-task-status="doing"]')),
            check: metrics($('.lubi-status-seg [data-task-status="todo"] .lubi-status-check')),
          };
          $('.lubi-status-seg [data-task-status="todo"]').setAttribute('aria-pressed','false');
          $('.lubi-status-seg [data-task-status="doing"]').setAttribute('aria-pressed','true');
          const after = {
            selected: metrics($('.lubi-status-seg [data-task-status="doing"]')),
            idle: metrics($('.lubi-status-seg [data-task-status="todo"]')),
            check: metrics($('.lubi-status-seg [data-task-status="doing"] .lubi-status-check')),
          };
          const blocked = $('.lubi-quick-chip-warn');
          const blockedBefore = metrics(blocked);
          blocked.setAttribute('aria-pressed','true');
          blocked.getAnimations().forEach((animation) => animation.finish());
          const blockedAfter = metrics(blocked);
          const result = {
            outlined: [...document.querySelectorAll('.lubi-extras-toggles button, .lubi-modal-actions .lubi-btn-ghost')].map(e=>{const c=getComputedStyle(e);return c.borderTopStyle==='solid'&&parseFloat(c.borderTopWidth)===1&&c.borderTopColor!=='rgba(0, 0, 0, 0)'}),
            width: ${item.width}, root: metrics($('.lubi-root')), page: metrics($('.lubi-page')),
            left: metrics($('#leftCard')), group: metrics($('#groupPath')), task: metrics($('#taskTitle')),
            taskActions: metrics($('#taskActions')), taskStart: metrics($('#taskActions .lubi-task-start')),
            titleText: metrics($('#taskTitle .lubi-task-title-text')), titleLine: parseFloat(getComputedStyle($('#taskTitle .lubi-task-title-text')).lineHeight),
            meta: metrics($('#taskMeta')), week: metrics($('#weekCard')), agenda: metrics($('#agenda')),
            chip: metrics($('#longChip')), day: metrics($('#longChip').closest('.lubi-week-day')),
            chipTwo: metrics($('#longChip').nextElementSibling),
            tabSelected: metrics($('#taskTab')), tabIdle: metrics($('#reviewTab')),
            date: metrics($('#dateLabel')), status: {before, after, blockedBefore, blockedAfter},
            catSelected: metrics($('.lubi-cat-option[aria-pressed="true"]')),
            catIdle: metrics($('.lubi-cat-option[aria-pressed="false"]')),
            primary: metrics($('#save')), undo: metrics($('#undo')),
          };
          $('#result').textContent = 'LUBI_TASK_UI:' + encodeURIComponent(JSON.stringify(result));
        </script></body>`;
      const file = join(tmp, `task-${index}.html`);
      writePage(file, page, "utf8");
      const run = spawnSync(browser, [
        "--headless=new", "--disable-gpu", "--disable-extensions", "--no-first-run",
        "--no-default-browser-check", "--disable-background-networking",
        "--window-size=1920,1100", "--force-device-scale-factor=1",
        `--user-data-dir=${join(tmp, `profile-${index}`)}`,
        "--dump-dom", pathToFileURL(file).href,
      ], { encoding: "utf8", timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
      assert.equal(run.status, 0, `Chrome failed: ${run.error || run.stderr?.slice(-500)}`);
      const matches = [...run.stdout.matchAll(/LUBI_TASK_UI:(%7B[A-Za-z0-9%._~!'()*-]+)/g)];
      assert(matches.length, `browser did not report task UI metrics: ${run.stderr?.slice(-700)} ${run.stdout.slice(-900)}`);
      const g = JSON.parse(decodeURIComponent(matches[matches.length - 1][1]));
      assert.equal(g.outlined.length,5);assert(g.outlined.every(Boolean), "optional buttons and cancel have individual visible borders");
      const label = `${item.width}px ${item.theme} themeAfter=${item.themeAfterPlugin} coarse=${!!item.coarse}`;
      const fits = (el, name) => {
        assert(el.scrollW <= el.clientW + 1, `${name} horizontal overflow ${label}: ${JSON.stringify(el)}`);
        assert(el.scrollH <= el.clientH + 2, `${name} clipped vertically ${label}: ${JSON.stringify(el)}`);
      };
      assert(g.page.scrollW <= g.page.clientW + 1, `tasks page horizontal overflow ${label}: ${JSON.stringify(g.page)}`);
      fits(g.group, "parent path"); fits(g.task, "task title"); fits(g.meta, "task details");
      assert(g.group.right <= g.left.right + 1 && g.task.right <= g.left.right + 1, `text must stay inside left card ${label}`);
      assert(Math.abs((g.taskStart.top + g.taskStart.h / 2) - (g.titleText.top + g.titleLine / 2)) <= 0.5 && g.taskStart.right<=g.left.right+1, `record action stays on the title first line and inside the row at every width ${label}: ${JSON.stringify({task: g.task, taskActions: g.taskActions, taskStart: g.taskStart})}`);
      assert.equal(g.group.whiteSpace, "normal", `parent path must wrap ${label}`);
      assert.equal(g.task.whiteSpace, "normal", `task title must wrap ${label}`);
      assert.equal(g.meta.whiteSpace, "normal", `task details must wrap ${label}`);
      if (item.width > 1100 || item.width <= 390) assert(g.task.h > 30, `long task title must gain height when constrained ${label}: ${g.task.h}`);
      if (item.width > 1100) assert(g.group.h > 30, `long parent path must gain height ${label}: ${g.group.h}`);
      if (item.width > 820) {
        assert(g.week.w > 400 && g.agenda.w === 0, `weekly view must be visible ${label}`);
        fits(g.chip, "all-day chip"); fits(g.chipTwo, "second all-day chip");
        assert.equal(g.chip.whiteSpace, "normal", `all-day title must wrap ${label}`);
        assert(g.chip.h > 28 && g.chipTwo.top >= g.chip.bottom - 1, `chips must stack without clipping ${label}: ${JSON.stringify(g.chip)}`);
        assert(g.chip.x >= g.day.x - 1 && g.chip.right <= g.day.right - 2, `all-day chip must fit grid column ${label}: ${JSON.stringify(g.chip)}`);
      } else assert(g.week.w === 0 && g.agenda.w > 0, `narrow panels must use agenda ${label}`);
      assert(g.status.before.selected.background !== g.status.before.idle.background, `initial status lacks highlight ${label}`);
      assert(g.status.after.selected.background !== g.status.after.idle.background, `changed status lacks highlight ${label}`);
      assert.equal(g.status.after.selected.shadow,"none",`MONO selected status does not use a shadow ${label}`);
      assert(g.status.after.selected.borderStyle === "solid" && parseFloat(g.status.after.selected.borderWidth) >= 1, `selected status keeps its border plus the visible non-color checkmark ${label}`);
      assert(g.status.before.check.visibility === "visible" && g.status.after.check.visibility === "visible", `status needs visible checkmark ${label}`);
      assert(g.status.blockedBefore.background !== g.status.blockedAfter.background, `blocked toggle lacks selected feedback ${label}: ${JSON.stringify([g.status.blockedBefore.background, g.status.blockedAfter.background])}`);
      assert(g.tabSelected.background !== g.tabIdle.background, `tab selection lacks highlight ${label}`);
      assert(g.catSelected.background !== g.catIdle.background, `category selection lost in theme ${label}`);
      assert(g.primary.background !== g.tabIdle.background, `primary action must differ from neutral ${label}`);
      assert(g.date.shadow === "none", `date navigation must not look like a raised theme button ${label}`);
      assert(g.undo.shadow === "none", `undo button must follow plugin style ${label}`);
      console.log(`ok   task text + seven-day chips + buttons ${label}; chip ${Math.round(g.chip.h)}px, title ${Math.round(g.task.h)}px`);
    }
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* Chrome may hold a temp profile briefly on Windows. */ }
  }
}
