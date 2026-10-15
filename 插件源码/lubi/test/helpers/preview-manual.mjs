// 生成教学手册 / README 截图用的静态预览页（演示数据，亮色 + 暗色），输出到 preview/manual/，配合 scripts/screenshots.py 使用。
import * as O from "./mock-obsidian.js";
import fs from "fs";
import { buildSync } from "esbuild";
const ganttLabelScript = buildSync({ entryPoints: ["src/ui/ganttLabels.ts"], bundle: true, write: false, format: "iife", globalName: "LubiGanttLabels" }).outputFiles[0].text;
const manifest = JSON.parse(fs.readFileSync(new URL("../../manifest.json", import.meta.url), "utf8"));
import { demoData, seedVault } from "./demo-data.mjs";
import Module from "module";
import { createRequire } from "module";
const origLoad = Module._load;
Module._load = function (req, ...a) { return req === "obsidian" ? O : origLoad.call(this, req, ...a); };
const require = createRequire(import.meta.url);
const LubiPlugin = require(process.env.LUBI_TEST_PLUGIN || "../../main.js").default;
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));

// 时钟固定在当天 14:30（照常走秒）：清晨 / 深夜运行时截图内容也一致（当天记录、现在线、逾期计划）
{
  const RealDate = Date;
  const base = new RealDate(`${process.env.LUBI_SCREENSHOT_DATE || "2026-10-09"}T14:30:00`);
  if (!Number.isFinite(base.getTime())) throw new Error("Invalid synthetic screenshot date");
  const off = base.getTime() - RealDate.now();
  globalThis.Date = class extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + off); }
    static now() { return RealDate.now() + off; }
  };
}
const app = new O.App();
const today = new Date();
const demo = demoData(today);
const T = demo.today;
seedVault(app.vault, demo);

const plugin = new LubiPlugin(app, manifest);
await plugin.onload();
for (const fn of app.workspace._ready) await fn();
await tick();
// Explicit conversion happens only in this in-memory synthetic Vault, never in a real Vault.
const linked = new Set();
for (const date of plugin.journal.dates()) for (const row of await plugin.journal.read(date)) if (row.rec.task) linked.add(row.rec.task);
await plugin.tasks.convertParentsToProjects(linked);
plugin.settings.onboardingDone = true;
const view = await plugin.activateView("today", T);
await tick(200);
const root = view.contentEl;

const shim = `
:root { --background-primary:#fff; --background-secondary:#f5f5f7; --background-modifier-border:#e3e3e8; --background-modifier-hover:rgba(0,0,0,.06);
 --text-normal:#1f1f24; --text-muted:#6f6f7a; --text-faint:#a6a6b0; --text-error:#d03a3a; --interactive-accent:#7b5cff; --text-on-accent:#fff;
 --color-red:#e03131; --color-blue:#1971c2; --color-green:#2f9e44; --color-purple:#7048e8; --color-orange:#e8590c; --color-yellow:#f08c00; --color-base-60:#8a8a94; --color-base-50:#9a9aa3;
 --font-ui-small:13px; --font-ui-smaller:12px; --font-ui-medium:15px; --radius-s:4px; --radius-m:8px; --radius-l:12px; --shadow-s:0 2px 8px rgba(0,0,0,.12); }
html,body { margin:0; height:100%; font-family: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; font-size:14px; color:var(--text-normal); background:var(--background-primary); }
button { font-family: inherit; }
.lubi-root { height: 100vh; }
.lubi-icon svg, .lubi-icon-btn svg, button svg { width:14px; height:14px; display:inline-block; }
input, select, textarea { font: inherit; border:1px solid var(--background-modifier-border); border-radius:6px; padding:0 8px; background:var(--background-primary); color:inherit; }
input[type=checkbox] { width:14px; height:14px; padding:0; }
textarea { padding:6px 8px; }
button.mod-cta { background: var(--interactive-accent); color:#fff; border:none; }
button { border:1px solid var(--background-modifier-border); background:var(--background-primary); color:inherit; border-radius:6px; }
.lubi-root { --lubi-panel-height: 100vh; }
body.theme-dark { --background-primary:#1e1e22; --background-secondary:#26262b; --background-modifier-border:#3a3a42; --background-modifier-hover:rgba(255,255,255,.07);
 --text-normal:#dcdce2; --text-muted:#a2a2ad; --text-faint:#72727d; --text-error:#ff6b6b; --interactive-accent:#8b6cff;
 --color-red:#ff6b6b; --color-blue:#4dabf7; --color-green:#51cf66; --color-purple:#9775fa; --color-orange:#ff922b; --color-yellow:#fcc419; --color-base-60:#8a8a94; --color-base-50:#6a6a73; }
.modal-bg { position:fixed; inset:0; background:rgba(0,0,0,.35); }
.modal { position:fixed; left:50%; top:60px; transform:translateX(-50%); background:var(--background-primary); border-radius:12px; padding:20px 24px 18px; box-shadow:0 12px 40px rgba(0,0,0,.25); box-sizing:border-box; }
.modal-title { font-size:18px; font-weight:700; margin-bottom:14px; }
`;
const styles = fs.readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
const freeze = (el) => { for (const i of el.querySelectorAll("input, textarea")) { if (i.type === "checkbox") { if (i.checked) i.setAttribute("checked", ""); } else if (i.tagName === "TEXTAREA") i.textContent = i.value; else i.setAttribute("value", i.value); } for (const s of el.querySelectorAll("select")) for (const o of s.options) o.toggleAttribute("selected", o.selected); return el.outerHTML; };
// 与真实视图一致：按 data-scroll-target 定位首屏
const boot = `<script>addEventListener("load",()=>{for(const el of document.querySelectorAll("[data-scroll-target]"))el.scrollTop=Number(el.dataset.scrollTarget)||0;});</script>`;
const labelBoot = `<script>${ganttLabelScript};addEventListener("load",()=>{LubiGanttLabels.fitGanttLabels(document);LubiGanttLabels.updateGanttNow(document,new Date(${JSON.stringify(new Date().toISOString())}));document.fonts.ready.then(()=>LubiGanttLabels.fitGanttLabels(document));});</script>`;
const page = (title, body, dark = false) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>${shim}${styles}</style></head><body class="${dark ? "theme-dark" : "theme-light"}">${body}${boot}${labelBoot}</body></html>`;
const out = new URL("../../preview/manual/", import.meta.url);
const outDark = new URL("dark/", out);
fs.mkdirSync(outDark, { recursive: true });
const origWrite = fs.writeFileSync.bind(fs);
fs.writeFileSync = (url, html) => {
  origWrite(url, html);
  const name = String(url).split("/").pop();
  origWrite(new URL(name, outDark), html.replace('<body class="theme-light">', '<body class="theme-dark">'));
};

// 1. 每日页
fs.writeFileSync(new URL("today.html", out), page("today", freeze(root)));
// 2. 回顾页
view.show("review"); await tick(200);
fs.writeFileSync(new URL("review.html", out), page("review", freeze(root)));
// 2b. 回顾页·年
{
  const yearBtn = [...root.querySelectorAll(".lubi-review .lubi-seg-item")].find((x) => x.textContent.trim() === "年");
  if (yearBtn) { yearBtn.click(); await tick(300); fs.writeFileSync(new URL("review-year.html", out), page("review-year", freeze(root))); }
  const weekBtn = [...root.querySelectorAll(".lubi-review .lubi-seg-item")].find((x) => x.textContent.trim() === "周");
  if (weekBtn) { weekBtn.click(); await tick(200); }
}
// 3. 任务页
view.tasksState.scheduleView="calendar";view.tasksState.period="week";view.show("tasks",T); await tick(200);
fs.writeFileSync(new URL("tasks.html", out), page("tasks", freeze(root)));
view.tasksState.scheduleView="gantt";view.tasksState.period="month";view.show("tasks",T);await tick(200);
fs.writeFileSync(new URL("projects-gantt.html",out),page("projects-gantt",freeze(root)));
view.tasksState.scheduleView="calendar";view.tasksState.period="week";
// 4. 编辑模态
view.show("today"); await tick(200);
const b = [...root.querySelectorAll(".lubi-block")].find((x) => x.textContent.includes("线性代数"));
if (!window.PointerEvent) window.PointerEvent = class extends window.MouseEvent { constructor(t, o = {}) { super(t, o); this.pointerId = 1; } };
b.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true, clientY: 100, button: 0 }));
window.dispatchEvent(new window.PointerEvent("pointerup", { bubbles: true, clientY: 100, button: 0 }));
await tick();
const m = O.openModals.at(-1);
m.modalEl.classList.add("modal");
m.titleEl.classList.add("modal-title");
m.contentEl.classList.add("modal-content");
fs.writeFileSync(new URL("modal.html", out), page("modal", `<div class="lubi-root" style="height:100vh;background:var(--background-secondary)"></div><div class="modal-bg"></div>${freeze(m.modalEl)}`));
m.close();
// 5. 新建记录模态（空）
plugin.quickLog(); await tick();
const nm = O.openModals.at(-1); nm.modalEl.classList.add("modal"); nm.titleEl.classList.add("modal-title"); nm.contentEl.classList.add("modal-content");
fs.writeFileSync(new URL("modal-new.html", out), page("modal-new", `<div class="lubi-root" style="height:100vh;background:var(--background-secondary)"></div><div class="modal-bg"></div>${freeze(nm.modalEl)}`));
nm.close();
const actual = new nm.constructor(app,plugin,{defaults:{title:"复习一个章节（合成示例）",category:"学习",date:T,start:"09:00",estimate:45},recordDate:T});
actual.open();await tick();
for (const [key,value,event] of [["minutes","60","input"],["start","09:00","change"]]) {
  const field=actual.contentEl.querySelector(`[data-actual=${key}]`);field.value=value;field.dispatchEvent(new window.Event(event,{bubbles:true}));
}
await tick();actual.modalEl.classList.add("modal");actual.titleEl.classList.add("modal-title");actual.contentEl.classList.add("modal-content");
fs.writeFileSync(new URL("estimate-comparison.html",out),page("estimate-comparison",`<div class="modal-bg"></div>${freeze(actual.modalEl)}`));actual.close();
// 6. 任务模态：点任务页里的一行
view.show("tasks"); await tick(200);
const rowEl = [...root.querySelectorAll(".lubi-task")].find((x) => x.textContent.includes("线性代数"));
rowEl.click(); await tick();
const tm = O.openModals.at(-1); const locationInput=tm.contentEl.querySelector("[data-task-location]");locationInput.value="图书馆（合成示例）";locationInput.dispatchEvent(new window.Event("input",{bubbles:true})); tm.modalEl.classList.add("modal"); tm.titleEl.classList.add("modal-title"); tm.contentEl.classList.add("modal-content");
fs.writeFileSync(new URL("modal-task.html", out), page("modal-task", `<div class="lubi-root" style="height:100vh;background:var(--background-secondary)"></div><div class="modal-bg"></div>${freeze(tm.modalEl)}`)); tm.close();

const wrapModal = (mm, name) => { mm.modalEl.classList.add("modal"); mm.titleEl.classList.add("modal-title"); mm.contentEl.classList.add("modal-content");
  fs.writeFileSync(new URL(name + ".html", out), page(name, `<div class="lubi-root" style="height:100vh;background:var(--background-secondary)"></div><div class="modal-bg"></div>${freeze(mm.modalEl)}`)); mm.close(); };
view.show("today", T); await tick(200); // 任务页的「新建」默认是任务；一行快速记录要在每日页打开
plugin.quickLog(); await tick();
{ const qm = O.openModals.at(-1); const inp = qm.contentEl.querySelector('input[type="text"]');
  inp.value = "9:00-10:30 学习 三明治定理"; inp.dispatchEvent(new window.Event("input", { bubbles: true })); await tick();
  wrapModal(qm, "modal-quick"); }
view.show("today"); await tick(200);
root.dispatchEvent(new window.KeyboardEvent("keydown", { key: "?", bubbles: true })); await tick();
{ const sm = O.openModals.at(-1); if (sm && sm.contentEl.querySelector(".lubi-shortcuts")) wrapModal(sm, "modal-keys"); }
{
  const app2 = new O.App();
  const p2 = new LubiPlugin(app2, manifest);
  await p2.onload(); for (const fn of app2.workspace._ready) await fn(); await tick();
  const v2 = await p2.activateView("today", T); await tick(200);
  fs.writeFileSync(new URL("empty.html", out), page("empty", freeze(v2.contentEl)));
}
console.log("preview written to", out.pathname);
process.exit(0);

