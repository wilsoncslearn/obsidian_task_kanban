// 生成静态预览 HTML（jsdom 渲染 + Obsidian 变量垫片），配合 test/helpers/shot.py 截图做视觉检查。
import * as O from "./mock-obsidian.js";
import fs from "fs";
import { buildSync } from "esbuild";
const ganttLabelScript = buildSync({ entryPoints: ["src/ui/ganttLabels.ts"], bundle: true, write: false, format: "iife", globalName: "LubiGanttLabels" }).outputFiles[0].text;
import { demoData, seedVault } from "./demo-data.mjs";
import Module from "module";
import { createRequire } from "module";
const origLoad = Module._load;
Module._load = function (req, ...a) { return req === "obsidian" ? O : origLoad.call(this, req, ...a); };
const require = createRequire(import.meta.url);
const LubiPlugin = require(process.env.LUBI_TEST_PLUGIN || "../.out/plugin.cjs").default;
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));

const app = new O.App();
const today = new Date();
// 至少生成到 14:00 的当天记录：深夜 / 清晨运行时时间轴也不为空，预览与布局用例不随运行时刻变化
const demo = demoData(today, Math.max(today.getHours() * 60 + today.getMinutes(), 14 * 60));
const T = demo.today;
seedVault(app.vault, demo);

const plugin = new LubiPlugin(app, { id: "lubi", version: "1.1.0" });
await plugin.onload();
for (const fn of app.workspace._ready) await fn();
await tick();
if (process.env.LUBI_TEST_DAY_START_PLAN === "1") {
  const now = new Date().toISOString();
  await plugin.tasks.upsert({
    id: "layout-midnight-plan", title: "午夜计划（布局回归）",
    category: plugin.settings.categories.find((c) => c.kind === "time")?.name || "学习",
    parent: null, status: "todo", blocked: false, date: T, start: "00:05", estimate: 15,
    repeat: { kind: "none", days: [] }, doneDates: [], doneLogs: undefined, skipDates: [],
    startDate: T, endDate: "", notes: "", order: Number.MAX_SAFE_INTEGER, doneAt: "",
    created: now, updated: now,
  });
}
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
.checkbox-container { display:inline-block; width:40px; height:22px; position:relative; border-radius:12px; background:var(--background-modifier-border); cursor:pointer; }
.checkbox-container::after { content:""; position:absolute; top:2px; left:2px; width:18px; height:18px; border-radius:50%; background:var(--background-primary); }
.checkbox-container.is-enabled { background:var(--interactive-accent); }
.checkbox-container.is-enabled::after { left:20px; }
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
// 静态页没有插件脚本：按 tasks.ts 同样的算法补上周日程的滚动条轨道宽度
const boot = `<script>addEventListener("load",()=>{for(const el of document.querySelectorAll("[data-scroll-target]"))el.scrollTop=Number(el.dataset.scrollTarget)||0;for(const b of document.querySelectorAll(".lubi-week-body"))b.parentElement.style.setProperty("--lubi-week-sbw",Math.max(0,b.offsetWidth-b.clientWidth)+"px");const g=document.querySelector(".lubi-gantt-card");if(g&&g.getBoundingClientRect().top>innerHeight-80)g.scrollIntoView({block:"start"});});</script>`;
const page = (title, body, dark = false) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>${shim}${styles}</style></head><body class="${dark ? "theme-dark" : "theme-light"}">${body}${boot}<script>${ganttLabelScript};addEventListener("load",()=>{LubiGanttLabels.fitGanttLabels(document);LubiGanttLabels.updateGanttNow(document);document.fonts?.ready.then(()=>LubiGanttLabels.fitGanttLabels(document));});</script></body></html>`;
const out = new URL("../../preview/", import.meta.url);
const outDark = new URL("dark/", out);
fs.mkdirSync(outDark, { recursive: true });
const origWrite = fs.writeFileSync.bind(fs);
fs.writeFileSync = (url, html) => {
  origWrite(url, html);
  const name = String(url).split("/").pop();
  origWrite(new URL(name, outDark), html.replace('<body class="theme-light">', '<body class="theme-dark">'));
};

// 设置页仅使用上述合成插件的默认设置，不读取实际 data.json。
const settingTab = plugin.settingTabs[0];
settingTab.display();
fs.writeFileSync(new URL("settings.html", out), page("settings", freeze(settingTab.containerEl)));

// Model dropdown previews exercise the public settings fetch, with synthetic responses.
{
 const saved={endpoint:plugin.settings.aiEndpoint,model:plugin.settings.aiModel};
 plugin.settings.aiEndpoint='https://synthetic.invalid/v1';plugin.settings.aiModel='deepseek-flash';
 settingTab.display();document.body.append(settingTab.containerEl);settingTab.containerEl.querySelector('.lubi-settings-ai').open=true;
 const models=['deepseek-flash','deepseek-v4.1-flash',...Array.from({length:34},(_,i)=>'other-model-'+i)];
 O.setRequestUrlHandler(()=>({status:200,json:{data:models.map(id=>({id}))}}));
 [...settingTab.containerEl.querySelectorAll('button')].find(button=>button.textContent==='获取模型列表').click();await tick(150);
 fs.writeFileSync(new URL('settings-models-all.html',out),page('settings-models-all',freeze(settingTab.containerEl)));
 const modelInput=settingTab.containerEl.querySelector('[data-setting=ai-model]');modelInput.value='deepseek';modelInput.dispatchEvent(new window.Event('input',{bubbles:true}));await tick(40);
 fs.writeFileSync(new URL('settings-models-filtered.html',out),page('settings-models-filtered',freeze(settingTab.containerEl)));
 settingTab.containerEl.remove();O.setRequestUrlHandler(null);plugin.settings.aiEndpoint=saved.endpoint;plugin.settings.aiModel=saved.model;
}
// JSON import uses only a synthetic example; no live tasks/settings are exported.
root.querySelector('.lubi-topbar-import').click();await tick(40);
const jsonModal=O.openModals.at(-1);jsonModal.modalEl.classList.add('modal');jsonModal.titleEl.classList.add('modal-title');jsonModal.contentEl.classList.add('modal-content');
jsonModal.contentEl.querySelector('textarea').value=JSON.stringify({tasks:[{title:'合成导入任务',category:'学习',date:T,start:'09:00',estimate:60}]},null,2);
fs.writeFileSync(new URL('modal-json-import.html',out),page('modal-json-import',`<div class="lubi-modal-preview"><div class="modal-bg"></div>${freeze(jsonModal.modalEl)}</div>`));jsonModal.close();
// 1. 每日页
fs.writeFileSync(new URL("today.html", out), page("today", freeze(root)));
// Freeze active drag states using synthetic plans/records, then cancel without persistence.
{
  const pointer=(target,type,y)=>{const e=new window.MouseEvent(type,{bubbles:true,cancelable:true,clientX:200,clientY:y,button:0});Object.defineProperty(e,'pointerId',{value:333});target.dispatchEvent(e)};
  for(const [area,selector] of [['record','.lubi-block'],['plan','.lubi-plan']]) for(const mode of ['move','resize-start','resize-end']) {
    const block=root.querySelector(selector);if(!block)throw new Error('Missing drag fixture: '+area);
    const handle=mode==='move'?block:block.querySelector(mode==='resize-start'?'.is-top':'.is-bottom');
    pointer(handle,'pointerdown',100);pointer(window,'pointermove',156);
    fs.writeFileSync(new URL('today-drag-'+area+(mode==='move'?'':'-'+mode)+'.html',out),page('today-drag-'+area,freeze(root)));
    window.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await tick(40);
  }
}
// 无实际记录的日期：保留分类底环，不清空演示数据。
view.show('today','2088-02-15');await tick(200);
fs.writeFileSync(new URL('today-empty.html',out),page('today-empty',freeze(root)));
view.show('today',T);await tick(200);
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
// 空回顾使用没有演示记录的周期；不清除或写入任何 Vault 数据。
{
  const savedReview = { ...view.review };
  for (const period of ['week','month','year']) {
    view.review.period=period;view.review.display='chart';view.show('review','2088-02-15');await tick(200);
    fs.writeFileSync(new URL('review-empty-'+period+'.html',out),page('review-empty-'+period,freeze(root)));
  }
  view.review={...savedReview};
}
// 3. 计划周视图
view.tasksState.period="week";view.show("tasks"); await tick(200);
fs.writeFileSync(new URL("tasks.html", out), page("tasks", freeze(root)));
// Freeze a real production hover event at a non-grid-aligned fractional pointer position.
{
  const col=root.querySelector('.lubi-week-col'),height=parseFloat(col.style.height),offset=123.4;
  const oldRect=col.getBoundingClientRect;
  col.getBoundingClientRect=()=>({top:-315.75,height:height*1.25,left:0,right:200,width:200,bottom:-315.75+height*1.25});
  col.dataset.hoverProbeY=String(offset);
  col.dispatchEvent(new window.MouseEvent('pointermove',{bubbles:true,clientY:-315.75+offset*1.25,clientX:100}));
  fs.writeFileSync(new URL('tasks-hover.html',out),page('tasks-hover',freeze(root)));
  col.getBoundingClientRect=oldRect;delete col.dataset.hoverProbeY;col.dispatchEvent(new window.MouseEvent('pointerleave'));
}

// 4. 编辑模态
view.show("today"); await tick(200);
const blocks = [...root.querySelectorAll(".lubi-block:not(.lubi-block-ghost)")];
const b = blocks.find((x) => x.textContent.includes("线性代数")) || blocks.find((x) => x.querySelector(".lubi-block-meta")) || blocks[0];
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
const actualForm=new nm.constructor(app,plugin,{defaults:{title:'实际用时布局（合成）',category:'学习',date:T,estimate:45},recordDate:T});actualForm.open();await tick(60);
for(const [key,value,event]of [['minutes','60','input'],['start','10:00','change']]){const input=actualForm.contentEl.querySelector('[data-actual='+key+']');input.value=value;input.dispatchEvent(new window.Event(event,{bubbles:true}))}
actualForm.modalEl.classList.add('modal');actualForm.titleEl.classList.add('modal-title');actualForm.contentEl.classList.add('modal-content');
fs.writeFileSync(new URL('modal-actual.html',out),page('modal-actual',`<div class="lubi-modal-preview"><div class="modal-bg"></div>${freeze(actualForm.modalEl)}</div>`));actualForm.close();
for(const [name,opts] of [
 ['modal-new-actual-only',{defaults:{title:'合成实际录入',category:'学习',date:T},recordDate:T,actualDefaults:{minutes:185,start:'07:00'}}],
 ['modal-new-planned',{defaults:{title:'合成规划录入',category:'学习',date:T,start:'07:45',estimate:160},recordDate:T}],
]) {
 const form=new nm.constructor(app,plugin,opts);form.open();await tick(60);form.modalEl.classList.add('modal');form.titleEl.classList.add('modal-title');form.contentEl.classList.add('modal-content');
 fs.writeFileSync(new URL(name+'.html',out),page(name,`<div class="lubi-modal-preview"><div class="modal-bg"></div>${freeze(form.modalEl)}</div>`));form.close();
}

// 6. 任务模态：点任务页里的一行
view.show("tasks"); await tick(200);
const rows = [...root.querySelectorAll(".lubi-task")];
const rowEl = rows.find((x) => x.textContent.includes("线性代数")) || rows[0];
rowEl.click(); await tick();
const tm = O.openModals.at(-1); tm.modalEl.classList.add("modal"); tm.titleEl.classList.add("modal-title"); tm.contentEl.classList.add("modal-content");
fs.writeFileSync(new URL("modal-task.html", out), page("modal-task", `<div class="lubi-root" style="height:100vh;background:var(--background-secondary)"></div><div class="modal-bg"></div>${freeze(tm.modalEl)}`)); tm.close();
// Open history-name lists with synthetic names only, for five-row browser geometry checks.
for (let i = 0; i < 8; i++) await plugin.tasks.upsert({
  id:`name-layout-${i}`,title:`打游戏 · 候选 ${i + 1}`,category:"学习",parent:null,status:"todo",blocked:false,
  date:"",start:"",estimate:0,repeat:{kind:"none",days:[]},doneDates:[],skipDates:[],startDate:"",endDate:"",notes:"",order:i,doneAt:"",created:`2026-01-0${i + 1}T00:00:00Z`,updated:"",
});
for (const [kind, Form, opts] of [["record",m.constructor,{date:T,defaults:{category:"学习",title:""}}],["task",tm.constructor,{defaults:{category:"学习",title:"",date:T}}]]) {
  const form = new Form(app,plugin,opts); form.open(); await tick(100);
  form.modalEl.classList.add("modal");form.titleEl.classList.add("modal-title");form.contentEl.classList.add("modal-content");
  const input = form.contentEl.querySelector('[role="combobox"]');input.value="";input.dispatchEvent(new window.Event("input",{bubbles:true}));input.focus();input.click();await tick(100);
  fs.writeFileSync(new URL(`names-${kind}.html`,out),page(`names-${kind}`,`<div class="lubi-modal-preview"><div class="modal-bg"></div>${freeze(form.modalEl)}</div>`));form.close();
}
// Gantt preview uses real task rendering with synthetic explicit/derived/repeating ranges.
{
  const {blankTask,weekStart,shiftDate}=await import("../.out/core.mjs");const start=weekStart(T);
  const task=(id,fields)=>blankTask({id,title:id,category:"学习",created:shiftDate(start,-30)+"T00:00:00Z",...fields});
  for(const t of [
    task("layout-gantt-parent",{title:"跨天规划（合成数据）",startDate:shiftDate(start,1),endDate:shiftDate(start,12),date:shiftDate(start,5)}),
    task("layout-gantt-child",{title:"子任务：资料整理与梳理，这是用于检查截断和固定名称栏的长标题",parent:"layout-gantt-parent",startDate:shiftDate(start,2),endDate:shiftDate(start,7),date:shiftDate(start,4)}),
    task("layout-gantt-done",{title:"已完成子任务",parent:"layout-gantt-parent",date:shiftDate(start,8),status:"done"}),
    task("layout-gantt-summary",{title:"由子任务汇总日期（只读）"}),
    task("layout-gantt-range",{title:"阶段二",parent:"layout-gantt-summary",startDate:shiftDate(start,9),endDate:shiftDate(start,18)}),
    task("layout-gantt-repeat",{title:"重复任务（跳过日留空）",repeat:{kind:"daily",days:[]},startDate:start,endDate:shiftDate(start,20),skipDates:[shiftDate(start,3)],doneDates:[shiftDate(start,1)]}),
    task("layout-gantt-edge",{title:"窗口裁切（不显示假边界手柄）",startDate:shiftDate(start,-4),endDate:shiftDate(start,30)}),
    task("layout-gantt-record",{title:"直接记录不应出现在甘特",date:start,origin:"record"})
  ])await plugin.tasks.upsert(t);
  view.show("tasks",T);await tick(250);
  [...root.querySelectorAll('.lubi-schedule-switch button')].find(b=>b.textContent==="甘特图").click();await tick(300);
  root.querySelector('[data-lubi-focus="planning-period:month"]').click();await tick(300);
  fs.writeFileSync(new URL('tasks-gantt.html',out),page('tasks-gantt',freeze(root)));
  root.querySelector('[data-task-id="layout-gantt-parent"] .lubi-gantt-collapse').click();await tick(300);
  fs.writeFileSync(new URL('tasks-gantt-collapsed.html',out),page('tasks-gantt-collapsed',freeze(root)));
}
// Today's hour-based Gantt, with midnight, un-timed, unset-estimate and clipped plans.
{
  const {blankTask}=await import("../.out/core.mjs");
  for(const t of [
    blankTask({id:"layout-daily-midnight",title:"午夜任务（合成）",date:T,start:"00:00",estimate:60,category:"学习"}),
    blankTask({id:"layout-daily-timed",title:"今日定时任务（合成）",date:T,start:"09:30",estimate:90,category:"学习"}),
    blankTask({id:"layout-daily-unset",title:"今日未定时（合成）",date:T,start:"",estimate:45,category:"学习"}),
    blankTask({id:"layout-daily-point",title:"未填预计（合成）",date:T,start:"11:00",estimate:0,category:"学习"}),
    blankTask({id:"layout-daily-late",title:"跨午夜计划（合成）",date:T,start:"23:45",estimate:90,category:"学习"})
  ])await plugin.tasks.upsert(t);
  [...root.querySelectorAll('.lubi-planning-period-switch button')].find(b=>b.dataset.lubiFocus==="planning-period:day").click();await tick(300);
  fs.writeFileSync(new URL('tasks-daily-gantt.html',out),page('tasks-daily-gantt',freeze(root)));
  root.querySelector('[data-lubi-focus="planning-period:week"]').click();await tick(300);
  fs.writeFileSync(new URL('tasks-week-gantt.html',out),page('tasks-week-gantt',freeze(root)));

}
// Real project grouping in planning geometry fixtures, alongside independent tasks.
{
 const project=await plugin.tasks.addProject('考研数学：基础知识复习与真题训练（合成项目）');
 const task=plugin.tasks.all.find(t=>t.date===T&&t.origin!=='record'&&!t.parent&&t.id!=='layout-gantt-parent');
 if(task)await plugin.tasks.upsert({...task,project:project.id,parent:null});
}
// All nine planning presentations, including month/list compact task labels.
{
  const {blankTask,shiftDate}=await import('../.out/core.mjs');
  for(const t of [
    blankTask({id:'planning-long',title:'合成规划任务：复习基础知识并整理错题与下一步安排',date:T,start:'08:00',estimate:60,category:'学习'}),
    blankTask({id:'planning-complete',title:'合成已完成任务',date:T,start:'12:00',estimate:30,status:'done',category:'运动'}),
    blankTask({id:'planning-span',title:'合成跨日任务',startDate:shiftDate(T,-2),endDate:shiftDate(T,3),category:'学习'})
  ])await plugin.tasks.upsert(t);
  for(const mode of ['calendar','gantt','list'])for(const period of ['day','week','month']) {
    view.tasksState.scheduleView=mode;view.tasksState.period=period;view.show('tasks',T);await tick(200);
    fs.writeFileSync(new URL(`planning-${mode}-${period}.html`,out),page(`planning-${mode}-${period}`,freeze(root)));
  }
}
// Project picker in the shared modal, including long names and inline creation.
{
 const project=await plugin.tasks.addProject('考研数学：基础知识复习与真题训练（合成项目）');
 view.tasksState.scheduleView='calendar';view.tasksState.period='day';view.show('tasks',T);await tick(250);
 view.openNew();await tick(40);const form=O.openModals.at(-1);
 [...form.contentEl.querySelectorAll('.lubi-extras-toggles button')].find(b=>b.textContent.trim()==='项目').click();
 const select=form.contentEl.querySelector('[data-task-project=select]');select.value=project.id;select.dispatchEvent(new window.Event('change',{bubbles:true}));
 form.modalEl.classList.add('modal');form.titleEl.classList.add('modal-title');form.contentEl.classList.add('modal-content');
 fs.writeFileSync(new URL('modal-project.html',out),page('modal-project',`<div class="lubi-modal-preview"><div class="modal-bg"></div>${freeze(form.modalEl)}</div>`));form.close();
}
// Async-workflow fixtures are generated only after legacy previews, so their data stays isolated.
{
 const {blankTask}=await import('../.out/core.mjs');
 const project=await plugin.tasks.addProject('音视频工具 · 合成异步项目');
 for(const task of [
  blankTask({id:'async-preview-review',title:'音视频风格拆解：审核 Agent 的分析结果并决定是否验收，这是一条用于验证窄屏换行的长标题',executor:'background',category:'日常',project:project.id}),
  blankTask({id:'async-preview-running',title:'后台 Agent 正在整理本科毕业论文材料（仅手动标注）',executor:'background',category:'学习',project:project.id})
 ])await plugin.tasks.upsert(task);
 await plugin.tasks.setBackgroundPhase('async-preview-review',T,'running');
 await plugin.tasks.setBackgroundPhase('async-preview-review',T,'review');
 await plugin.tasks.setBackgroundPhase('async-preview-running',T,'running');
 view.tasksState.scheduleView='calendar';view.tasksState.period='day';view.show('tasks',T);await tick(250);
 root.querySelector('.lubi-background-card').open=true;
 fs.writeFileSync(new URL('async-workflow.html',out),page('async-workflow',freeze(root)));
 view.openNew();await tick(40);const Form=O.openModals.at(-1).constructor;O.openModals.at(-1).close();
 const form=new Form(app,plugin,{task:plugin.tasks.byId('async-preview-review'),recordDate:T,actualRequired:true});form.open();await form.actualLoading;
 form.actualText='10min';form.actualStart='14:00';form.actualEdited=true;form.render(false);
 form.modalEl.classList.add('modal');form.titleEl.classList.add('modal-title');form.contentEl.classList.add('modal-content');
 fs.writeFileSync(new URL('modal-async.html',out),page('modal-async',`<div class="lubi-modal-preview"><div class="modal-bg"></div>${freeze(form.modalEl)}</div>`));form.close();
}
console.log("preview written to", out.pathname);
process.exit(0);

