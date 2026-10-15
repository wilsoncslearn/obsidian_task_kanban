// v1.4 browser layout regression: renders the real views (synthetic data via test/helpers/preview.mjs)
// and checks, in a real Chromium layout engine:
//   1. the tab switcher keeps the same x offset on every page (no jumping)
//   2. no visible text is smaller than 11px
//   3. the first hour label of each timeline is not clipped by its scroller
//   4. the top bar never overflows horizontally and its zones do not overlap
//   5. every visible text node has WCAG contrast ≥ 4.5:1 against its background (light + dark)
// Uses synthetic data only; no vault files or browser profiles are read.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { findBrowser } from "../helpers/browser.mjs";
import { writePage } from "../helpers/page.mjs";
import { DESIGN } from "../helpers/design.mjs";

const project = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const browser = findBrowser();

if (!browser) {
  if (process.env.LUBI_REQUIRE_BROWSER === "1") throw new Error("Chrome/Edge is required for top bar layout regression");
  console.log("SKIP top bar geometry: install Chrome/Edge or set LUBI_BROWSER");
} else {
  // 1) plugin bundle for node + static previews
  if (!existsSync(join(project, "test", ".out", "plugin.cjs"))) {
    const esb = spawnSync(process.execPath, [join(project, "node_modules", "esbuild", "bin", "esbuild"), "src/main.ts", "--bundle", "--platform=node", "--format=cjs", "--external:obsidian", "--outfile=test/.out/plugin.cjs", "--log-level=warning"], { cwd: project, encoding: "utf8" });
    assert.equal(esb.status, 0, `esbuild failed: ${esb.stderr}`);
  }
  const cueBundle = spawnSync(process.execPath, [join(project, "node_modules", "esbuild", "bin", "esbuild"), "src/ui/dragReadout.ts", "--bundle", "--format=iife", "--global-name=LubiDragReadout", "--log-level=warning"], { cwd: project, encoding: "utf8" });
  assert.equal(cueBundle.status, 0, "drag readout browser bundle failed");
  const gen = spawnSync(process.execPath, [join(project, "test", "helpers", "preview.mjs")], { cwd: project, encoding: "utf8", timeout: 60000, env: { ...process.env, LUBI_TEST_DAY_START_PLAN: "1" } });
  assert.equal(gen.status, 0, `preview generation failed: ${gen.stderr?.slice(-800)}`);

  const probe = `<script>${cueBundle.stdout}</script><script>addEventListener("error",event=>{const value={browserError:event.message,browserStack:event.error?.stack};const el=document.getElementById("lubi-result");if(el)el.textContent="LUBI_TOPBAR:"+encodeURIComponent(JSON.stringify(value)).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16));if(parent!==window)parent.postMessage({type:"lubi-geometry",value},"*");});</script>` + String.raw`<pre id="lubi-result"></pre><script>
  (() => {
    const out = { viewportWidth: innerWidth };
    const r = (el) => el ? el.getBoundingClientRect() : null;
    const chartHead=document.querySelector('.lubi-chart-card > .lubi-panel-head');
    if(chartHead){
      const title=chartHead.querySelector('.lubi-panel-title'),mode=chartHead.querySelector('.lubi-chart-mode');
      out.reviewHeader={gap:r(mode).left-r(title).right,sameRow:Math.abs((r(mode).top+r(mode).height/2)-(r(title).top+r(title).height/2))<=1};
      const checkBarState=selector=>{
        const col=document.querySelector(selector);if(!col)return null;
        const saved=col.className;col.classList.add('is-today');col.classList.remove('is-future');
        const stack=col.querySelector('.lubi-bar-stack'),label=col.querySelector('.lubi-bar-label'),style=getComputedStyle(stack),color=getComputedStyle(label).backgroundColor;
        const value={height:r(stack).height,outline:style.outlineStyle!=='none'&&parseFloat(style.outlineWidth)>0,badge:color!=='transparent'&&color!=='rgba(0, 0, 0, 0)'};
        col.className=saved;return value;
      };
      out.reviewBarStates={zero:checkBarState('.lubi-bar-col.is-empty'),filled:checkBarState('.lubi-bar-col:not(.is-empty)')};
    }
    const emptyReview=document.querySelector('.lubi-review-empty-note');
    if(emptyReview){
      const chart=document.querySelector('.lubi-chart'),grid=document.querySelector('.lubi-chart-grid'),bars=[...document.querySelectorAll('.lubi-bar-col')];
      out.emptyReview={metrics:!!document.querySelector('.lubi-kpis'),details:!!document.querySelector('.lubi-review-extras'),chartHeight:r(chart)?.height||0,gridHeight:r(grid)?.height||0,buckets:bars.length,zeroBars:bars.every(el=>el.classList.contains('is-empty')&&!el.querySelector('.lubi-bar-seg')),invalid:/NaN|Infinity/.test(document.querySelector('.lubi-review').textContent),bodyOverflow:document.body.scrollWidth-innerWidth};
    }
    const bar = document.querySelector('.lubi-topbar');
    const tabs = document.querySelector('.lubi-topbar-tabs');
    const left = document.querySelector('.lubi-topbar-left');
    const right = document.querySelector('.lubi-topbar-right');
    out.tabsX = r(tabs) && Math.round(r(tabs).left);
    out.tabsW = r(tabs) && Math.round(r(tabs).width);
    const ai=document.querySelector('.lubi-topbar-ai'),cta=document.querySelector('.lubi-topbar-cta');
    const dateButton=document.querySelector('.lubi-date-label'),caption=dateButton?.firstElementChild;out.dateCaption=caption&&r(dateButton).width>0?{oneLine:getComputedStyle(caption).whiteSpace==='nowrap'||r(caption).height<=parseFloat(getComputedStyle(caption).lineHeight)+1,contained:r(caption).top>=r(dateButton).top-1&&r(caption).bottom<=r(dateButton).bottom+1}:null;
    const jsonButton=document.querySelector('.lubi-topbar-import');out.jsonEntry=jsonButton?{visible:getComputedStyle(jsonButton).display!=='none'&&r(jsonButton).width>0,left:jsonButton.nextElementSibling===ai&&r(jsonButton).right<=r(ai).left+.5,inside:r(jsonButton).left>=0&&r(jsonButton).right<=innerWidth,secondary:!jsonButton.classList.contains('mod-cta'),named:(jsonButton.getAttribute('aria-label')||document.getElementById(jsonButton.getAttribute('aria-labelledby'))?.textContent)==='JSON 任务导入'}:null;
    out.aiEntry=ai?{visible:getComputedStyle(ai).display!=='none'&&r(ai).width>0&&r(ai).height>0,left:ai.nextElementSibling===cta&&r(ai).right<=r(cta).left+.5,inside:r(ai).left>=0&&r(ai).right<=innerWidth,secondary:!ai.classList.contains('mod-cta'),named:(ai.getAttribute("aria-label")||document.getElementById(ai.getAttribute("aria-labelledby"))?.textContent)==="AI 创建任务",icon:!!ai.querySelector('svg')}:null;
    out.tabOrder=tabs?[...tabs.querySelectorAll('button')].map(b=>b.dataset.lubiFocus).join('|'):null;
    out.tabLabels=tabs?[...tabs.querySelectorAll('button > span:not(.lubi-icon)')].map(e=>({text:e.textContent,visible:getComputedStyle(e).display!=='none'&&r(e).width>0&&r(e).height>0})):[];
    out.referenceControls = [...document.querySelectorAll('.lubi-root .lubi-seg')].map(group => {
      const buttons = [...group.querySelectorAll('.lubi-seg-item')], before = buttons.map(b => r(b).width);
      const states = buttons.map(b => b.getAttribute('aria-pressed'));
      buttons.forEach(b => b.setAttribute('aria-pressed', 'true'));
      const stable = buttons.every((b, i) => Math.abs(r(b).width - before[i]) < .5);
      buttons.forEach((b, i) => b.setAttribute('aria-pressed', states[i]));
      return { stable, heights: buttons.map(b => r(b).height), selected: buttons.filter(b => b.getAttribute('aria-pressed') === 'true').every(b => getComputedStyle(b).boxShadow === 'none') };
    });
    const progress = document.querySelector('.lubi-plan-progress');
    if (progress) {
      const done = +progress.getAttribute('aria-valuenow'), total = +progress.getAttribute('aria-valuemax');
      const fill = progress.querySelector('.lubi-plan-progress-fill');
      out.planProgress = { done, total, ratio: r(fill).width / r(progress).width, label: progress.getAttribute('aria-valuetext'), height: r(progress).height };
    }
    const readout=document.querySelector('.lubi-drag-readout:not([hidden])');
    if (readout) {
      const target = document.querySelector('.lubi-block.is-dragging,.lubi-plan.is-dragging'), scroller = document.querySelector('.lubi-timeline-scroll');
      const timeline = document.querySelector('.lubi-timeline'), wrap = document.querySelector('.lubi-timeline-wrap'), canvas = document.querySelector('.lubi-tl-canvas'), guide = canvas.querySelector('.lubi-tl-hover');
      const body = document.querySelector('.lubi-body');
      if (r(scroller).bottom > r(body).bottom) body.scrollTop += r(scroller).bottom - r(body).bottom + 4;
      scroller.scrollTop = Math.max(0, parseFloat(guide.style.top) + 32 - scroller.clientHeight / 2);
      const position = () => LubiDragReadout.positionDragReadout(readout, target, scroller, timeline, wrap);
      position();
      const sr=r(scroller), rr=r(readout), axis=r(canvas).left, line=r(guide);
      const texts=[...document.querySelectorAll('.lubi-block-title,.lubi-block-time,.lubi-plan-title,.lubi-plan-time,.lubi-hour-label,.lubi-now-label')];
      out.dragFeedback={visible:rr.width>0&&rr.height>0&&getComputedStyle(readout).visibility!=='hidden',contained:rr.left>=0&&rr.right<=innerWidth&&rr.bottom<=Math.min(sr.bottom,r(body).bottom),leftOfAxis:rr.right<=axis&&axis-rr.right<=4.5,aligned:Math.abs(rr.top+rr.height/2-line.top-line.height/2)<.6,guideToAxis:Math.abs(line.left-axis)<.6,fullText:readout.scrollWidth<=readout.clientWidth,singleLine:getComputedStyle(readout).whiteSpace==='nowrap'&&!readout.firstChild.textContent.includes("\n")&&rr.height<=22,inlineHidden:document.querySelector('.lubi-tl-hover-label').hidden,noTextOverlap:texts.every(el=>{if(getComputedStyle(el).visibility==='hidden')return true;const tr=r(el);const top=Math.max(tr.top,sr.top),bottom=Math.min(tr.bottom,sr.bottom),left=Math.max(tr.left,sr.left),right=Math.min(tr.right,sr.right);return bottom<=top||right<=left||right<=rr.left||left>=rr.right||bottom<=rr.top||top>=rr.bottom}),area:readout.dataset.area};
      const before=r(readout).top, previousScroll=scroller.scrollTop; scroller.scrollTop+=17; position();
      out.dragFeedback.scrollSynced=Math.abs((r(readout).top-before)+(scroller.scrollTop-previousScroll))<.6;
      // Opaque foreground cards reproduce the guide being hidden by card backgrounds.
      const originalArea=guide.dataset.area, obstacles=[]; guide.dataset.area='plan';
      for (const selector of ['.lubi-block:not(.lubi-block-ghost)','.lubi-plan']) {
        const original=timeline.querySelector(selector), clone=original.cloneNode(true), parent=original.parentElement;
        clone.classList.remove('is-dragging','is-moving','is-resizing','is-selected','is-compact','lubi-block-compact','lubi-drag-guide-host');
        clone.querySelectorAll('.lubi-drag-guide-segment').forEach(el=>el.remove());
        clone.style.top=(r(guide).top-r(parent).top-12)+'px'; clone.style.height='60px'; clone.style.zIndex='8'; clone.style.background='var(--background-primary)';
        if (selector.startsWith('.lubi-block')) { clone.style.left='8px'; clone.style.width='45%'; }
        parent.appendChild(clone); obstacles.push(clone);
      }
      position();
      out.dragFeedback.cardGuideVisible=obstacles.every(card=>{
        const segment=card.querySelector(':scope > .lubi-drag-guide-segment'); if (!segment) return false;
        const cs=getComputedStyle(segment), box=r(segment), rule=r(guide), foreground=card.querySelector('.lubi-block-head,.lubi-plan-head');
        const textStyle=getComputedStyle(foreground), textBox=r(foreground);
        segment.style.pointerEvents='auto';
        const fillHit=document.elementFromPoint(box.left+4,box.top+box.height/2), textLayers=document.elementsFromPoint(textBox.left+2,box.top+box.height/2);
        segment.style.pointerEvents='';
        return card.classList.contains('lubi-drag-guide-host')&&cs.borderTopStyle==='dashed'&&parseFloat(cs.borderTopWidth)===1&&cs.pointerEvents==='none'&&box.width>20&&Math.abs(box.top-rule.top)<.6&&fillHit===segment&&parseInt(textStyle.zIndex)>parseInt(cs.zIndex)&&textLayers.indexOf(foreground)>=0&&textLayers.indexOf(foreground)<textLayers.indexOf(segment);
      });
      obstacles.forEach(el=>el.remove()); guide.dataset.area=originalArea; position();
      const originalTop=guide.style.top;
      out.dragFeedback.boundaries=[0,1344].every(top=>{guide.style.top=top+'px';scroller.scrollTop=top;position();const label=r(readout),rule=r(guide),tick=timeline.querySelector(top===0?'.is-day-start':'.is-day-end');return getComputedStyle(readout).visibility!=='hidden'&&Math.abs(label.top+label.height/2-rule.top-rule.height/2)<.6&&getComputedStyle(tick).visibility==='hidden';});
      guide.style.top=originalTop; scroller.scrollTop=previousScroll; position();
      scroller.scrollTop=0; guide.style.top='2000px'; position();
      out.dragFeedback.offscreenHidden=getComputedStyle(readout).visibility==='hidden'&&!timeline.querySelector('.lubi-drag-obscured,.lubi-drag-guide-segment,.lubi-drag-guide-host');
      guide.style.top=originalTop; scroller.scrollTop=previousScroll; position();
    }
    out.barOverflow = bar ? bar.scrollWidth - bar.clientWidth : -1;
    const lr = r(left), tr = r(tabs), rr = r(right);
    out.zoneOverlap = (lr && tr && lr.width && lr.right > tr.left + 1 && getComputedStyle(tabs).gridRow === getComputedStyle(left).gridRow) || (rr && tr && rr.left < tr.right - 1 && getComputedStyle(tabs).gridRow === getComputedStyle(right).gridRow);
    // 精简界面仍保留主操作、所有折叠内容和键盘辅助入口。
    out.primaryActions = [...document.querySelectorAll(".lubi-root .mod-cta")].filter(e => r(e).width > 0 && r(e).height > 0 && getComputedStyle(e).display !== "none").length;
    out.newTaskVisible = !!cta && r(cta).width > 0 && r(cta).height > 0 && getComputedStyle(cta).display !== "none";
    if(document.querySelector('.lubi-root[data-tab="review"]') && out.newTaskVisible) out.reviewCreationError = "review must not show the new-task button";
    const jsonModal=document.querySelector('.lubi-json-import-modal');if(jsonModal){const box=r(jsonModal),input=jsonModal.querySelector('textarea');out.jsonModal={textVisible:r(input).width>0&&r(input).height>=180,inside:r(input).left>=box.left&&r(input).right<=box.right,overflow:document.documentElement.scrollWidth-innerWidth,buttons:[...jsonModal.querySelectorAll('.lubi-modal-actions button')].map(b=>({text:b.textContent,visible:r(b).width>0&&r(b).height>0}))};}
    out.simplifyErrors = [];
    const unifiedModal=document.querySelector('.lubi-task-modal');
    if(unifiedModal&&unifiedModal.querySelector('[data-actual=minutes]')) {
      const box=r(unifiedModal),hint=unifiedModal.querySelector('.lubi-actual-hint');
      const details=unifiedModal.querySelector('.lubi-actual-details');
      out.newTaskDetails=details?{visible:!details.hidden&&getComputedStyle(details).display!=='none',open:details.open,summary:details.querySelector('summary')?.textContent,inputsFit:[...details.querySelectorAll('input')].every(input=>r(input).width>0&&r(input).left>=box.left&&r(input).right<=box.right),hintVisible:hint?getComputedStyle(hint).display!=='none'&&r(hint).height>0:false,hint:hint?.textContent,removedInstruction:unifiedModal.textContent.includes('留空保存计划；填写实际用时后保存并完成任务')}:null;
      const plan=unifiedModal.querySelector('.lubi-plan-grid'),planFields=plan?[...plan.children]:[],actualFields=details?[...details.querySelectorAll('.lubi-field')]:[];
      const planDate=plan?.querySelector('input[type=date]'),planStart=plan?.querySelector('input[type=time]');
      const location=unifiedModal.querySelector('.lubi-location-field'),repeat=unifiedModal.querySelector('.lubi-repeat-field');
      out.locationField={ordered:repeat.nextElementSibling===location&&location.nextElementSibling.tagName==='HR',fits:r(location.querySelector('input')).left>=box.left&&r(location.querySelector('input')).right<=box.right,named:location.querySelector('label').textContent==='地点（可选）'};
      out.taskFieldOrder={plan:planFields.map(e=>e.querySelector('label')?.textContent),actual:actualFields.map(e=>e.querySelector('label')?.textContent),planPair:!planDate||(Math.abs(r(planDate).top-r(planStart).top)<=1&&r(planDate).right<=r(planStart).left),actualPair:actualFields.length===3&&Math.abs(r(actualFields[0]).top-r(actualFields[1]).top)<=1&&r(actualFields[0]).right<=r(actualFields[1]).left,actualBelow:actualFields.length===3&&r(actualFields[2]).top>=r(actualFields[0]).bottom};
      out.unifiedActual={modes:[...unifiedModal.querySelectorAll('.lubi-kind-seg button')].map(button=>button.dataset.lubiFocus),duration:unifiedModal.querySelector('[data-actual=minutes]').value,comparison:hint?.textContent,inputsFit:[...unifiedModal.querySelectorAll('input')].filter(input=>r(input).width>0).every(input=>r(input).left>=box.left&&r(input).right<=box.right),overflow:document.documentElement.scrollWidth-innerWidth};
    }
    const projectSelect=document.querySelector('[data-task-project=select]'),projectName=document.querySelector('[data-task-project=name]');
    if(projectSelect&&projectName){const host=projectSelect.closest('.lubi-task-modal'),create=[...host.querySelectorAll('button')].find(b=>b.textContent.trim()==='创建项目'),box=r(host),controls=[projectSelect,projectName,create];out.projectForm={fit:controls.every(e=>e&&r(e).width>0&&r(e).left>=box.left&&r(e).right<=box.right),overlap:Math.abs(r(projectName).top-r(create).top)<=2&&r(projectName).right>r(create).left+1,named:!!(projectSelect.getAttribute('aria-label')||document.getElementById(projectSelect.getAttribute('aria-labelledby'))?.textContent)&&!!projectName.getAttribute('aria-label'),value:projectSelect.value,overflow:document.documentElement.scrollWidth-innerWidth};}
    const sidebar = document.querySelector(".lubi-today-side");
    if (sidebar && (sidebar.classList.contains("lubi-card") || sidebar.querySelector(".lubi-card .lubi-card"))) out.simplifyErrors.push("nested daily cards");
    const emptyRing=sidebar?.querySelector('.lubi-distribution .lubi-donut');
    if(emptyRing&&emptyRing.querySelector('.lubi-donut-center')?.textContent==='0h'){
      const card=emptyRing.closest('.lubi-distribution'),box=r(emptyRing),center=emptyRing.querySelector('.lubi-donut-center'),sub=emptyRing.querySelector('.lubi-donut-sub'),base=emptyRing.querySelector('circle');
      out.emptyDonut={width:box.width,height:box.height,contained:box.left>=r(card).left&&box.right<=r(card).right&&box.top>=r(card).top&&box.bottom<=r(card).bottom,center:center.textContent,sub:sub.textContent,circles:emptyRing.querySelectorAll('circle').length,slices:emptyRing.querySelectorAll('circle[stroke-dasharray]').length,baseVisible:!!base&&getComputedStyle(base).stroke!=='none'&&parseFloat(getComputedStyle(base).strokeWidth)>0,cardOverflow:card.scrollWidth-card.clientWidth};
    }
    const planCard = sidebar?.querySelector(".lubi-plan-card");
    if (planCard && (!planCard.classList.contains("lubi-card") || !planCard.previousElementSibling?.classList.contains("lubi-distribution") || !planCard.querySelector(".lubi-plan-progress") || !planCard.querySelector(".lubi-plan-task-details > summary"))) out.simplifyErrors.push("plan card not separated or progress missing");
    if (planCard && r(planCard).top < r(sidebar.querySelector(".lubi-distribution")).bottom + 1) out.simplifyErrors.push("plan card overlaps distribution");
    if (sidebar) {
      const distribution = sidebar.querySelector(".lubi-distribution");
      if (!distribution || sidebar.querySelector(".lubi-personal-time")?.nextElementSibling !== distribution || distribution.matches("details") || (distribution.querySelector(".lubi-donut") && r(distribution.querySelector(".lubi-donut")).height <= 0)) out.simplifyErrors.push("distribution hidden or not after background/personal time");
    }
    if(document.querySelector(".lubi-tasks-projects, .lubi-project-toggle, .lubi-gantt, .lubi-project-peek")) out.simplifyErrors.push("removed project panel is still rendered");
    const lists = document.querySelector(".lubi-task-lists");
    if (lists && !lists.classList.contains("lubi-today-side") && (lists.classList.contains("lubi-card") || lists.querySelector(".lubi-list-card .lubi-list-card"))) out.simplifyErrors.push("nested list cards");
    if ([...document.querySelectorAll(".lubi-summary-label")].some(el => el.textContent === "计划完成")) out.simplifyErrors.push("duplicate plan completion");
    if (document.querySelector(".lubi-review-signals, .lubi-tl-hint, .lubi-tl-stats, .lubi-onboard")) out.simplifyErrors.push("repeated statistics or guidance");
    for (const el of document.querySelectorAll(".lubi-root, .lubi-root *")) {
      const style = getComputedStyle(el);
      if (style.backgroundImage.includes("gradient") || (style.backdropFilter && style.backdropFilter !== "none")) out.simplifyErrors.push("decorative effect " + el.className);
    }
    for (const el of document.querySelectorAll(".lubi-kpi")) if (parseFloat(getComputedStyle(el).borderTopWidth)) out.simplifyErrors.push("independent KPI card");
    const task = document.querySelector(".lubi-task:has(.lubi-task-start)");
    if (task) {
      if (getComputedStyle(task.querySelector(".lubi-task-start")).display === "none") out.simplifyErrors.push("start hidden");
      const label = task.querySelector("button.lubi-task-title");
      label?.focus();
      for (const action of task.querySelectorAll(".lubi-task-actions button")) if (getComputedStyle(action).display === "none") out.simplifyErrors.push("keyboard action hidden");
      label?.blur();
    }
    for (const col of document.querySelectorAll('.lubi-week-col')) if (getComputedStyle(col).cursor !== 'crosshair') out.simplifyErrors.push('planning blank grid cursor is not crosshair');
    for (const block of document.querySelectorAll('.lubi-wblock')) {
      if (getComputedStyle(block).cursor !== 'grab') out.simplifyErrors.push('planning task lost drag cursor');
      for (const handle of block.querySelectorAll('.lubi-block-handle')) if (getComputedStyle(handle).cursor !== 'ns-resize') out.simplifyErrors.push('planning handle lost resize cursor');
    }
    const ranking=document.querySelector('.lubi-review-top');
    if(ranking) {
      const rows=[...ranking.querySelectorAll('.lubi-row-bar')];
      if(ranking.querySelector('h3').textContent!=="事项 Top 5" || rows.length>5 || ranking.querySelector('.lubi-legend-bar')) out.simplifyErrors.push('Top5 title/count or legacy line');
      const reference=document.querySelector('.lubi-review-grid > .lubi-section:first-child .lubi-track');
      for(const row of rows) {
        const track=row.querySelector('.lubi-track'),fill=row.querySelector('.lubi-fill'),head=row.querySelector('.lubi-row-bar-head'),name=row.querySelector('.lubi-legend-name');
        if(!track||!fill||!head||!row.querySelector('.lubi-top-count')) {out.simplifyErrors.push('Top5 missing shared bar structure');continue;}
        if(r(row).width && (row.scrollWidth>row.clientWidth+1 || r(head).bottom>r(track).top || r(name).right>r(row.querySelector('.lubi-top-count')).left+.5 || getComputedStyle(track).height!==getComputedStyle(reference).height || getComputedStyle(track).backgroundColor!==getComputedStyle(reference).backgroundColor || getComputedStyle(track).borderRadius!==getComputedStyle(reference).borderRadius || getComputedStyle(fill).backgroundColor!==getComputedStyle(row.querySelector('.lubi-dot')).backgroundColor)) out.simplifyErrors.push('Top5 alignment, category color or track fidelity '+JSON.stringify({overflow:row.scrollWidth-row.clientWidth,headBottom:r(head).bottom,trackTop:r(track).top,nameRight:r(name).right,countLeft:r(row.querySelector('.lubi-top-count')).left,height:[getComputedStyle(track).height,getComputedStyle(reference).height],background:[getComputedStyle(track).backgroundColor,getComputedStyle(reference).backgroundColor],radius:[getComputedStyle(track).borderRadius,getComputedStyle(reference).borderRadius],fill:getComputedStyle(fill).backgroundColor,dot:getComputedStyle(row.querySelector('.lubi-dot')).backgroundColor}));
      }
    }
    out.foldStates = [...document.querySelectorAll(".lubi-fold")].map(d => ({ open: d.open, summaryVisible: r(d.querySelector("summary")).height > 0, planTasks: d.classList.contains("lubi-plan-task-details"), gaps: d.classList.contains("lubi-gap-card") }));
    const planRow = document.querySelector('.lubi-plan-task-list .lubi-task:has(.lubi-task-meta)');
    if (planRow) {
      const clone = planRow.cloneNode(true); clone.querySelector('.lubi-dot')?.remove(); planRow.parentElement.appendChild(clone);
      const meta=planRow.querySelector('.lubi-task-meta'),title=planRow.querySelector('.lubi-task-title-text');
      out.planMetaAligned = Math.abs(r(meta).left+parseFloat(getComputedStyle(meta).paddingLeft)-r(title).left)<=.5 && parseFloat(getComputedStyle(clone.querySelector('.lubi-task-meta')).paddingLeft) === 0;
      clone.remove();
    }
    // smallest visible text
    let min = 99, minAt = '';
    const walker = document.createTreeWalker(document.querySelector('.lubi-root, .lubi-modal, .lubi-settings'), NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const t = walker.currentNode; if (!t.nodeValue.trim()) continue;
      const el = t.parentElement; if (!el || el.closest('.lubi-sr-only, script, style')) continue;
      const cs = getComputedStyle(el); const box = el.getBoundingClientRect();
      if (cs.visibility === 'hidden' || cs.display === 'none' || box.width === 0 || box.height === 0 || el.closest('[hidden]')) continue;
      const fs = parseFloat(cs.fontSize);
      if (fs < min) { min = fs; minAt = (el.className || el.tagName) + ' "' + t.nodeValue.trim().slice(0, 16) + '"'; }
    }
    out.minFont = min; out.minAt = minAt;
    // first hour label of each scroller must be inside the scroller at scrollTop 0
    out.clipped = [];
    for (const [sel, lab] of [['.lubi-timeline-scroll', '.lubi-hour-label'], ['.lubi-week-body', '.lubi-week-hour']]) {
      const sc = document.querySelector(sel); if (!sc) continue;
      sc.scrollTop = 0;
      const first = sc.querySelector(lab); if (!first || !first.textContent.trim()) continue;
      const a = r(sc), b = r(first);
      if (b.top < a.top - 0.5) out.clipped.push(sel + ' ' + first.textContent.trim() + ' top ' + Math.round(b.top - a.top) + 'px');
    }
    // Daily boundary labels must remain visible at both scroll limits.
    out.dayBoundaryClipped = [];
    {
      const sc = document.querySelector(".lubi-timeline-scroll");
      if (sc) {
        for (const edge of [{ text: "00:00", position: 0, selector: ".lubi-hour-label.is-day-start" }, { text: "24:00", position: Math.max(0, sc.scrollHeight - sc.clientHeight), selector: ".lubi-hour-label.is-day-end" }]) {
          sc.scrollTop = edge.position;
          const label = sc.querySelector(edge.selector), box = r(label), frame = r(sc);
          const visibleTop = frame.top + sc.clientTop, visibleBottom = visibleTop + sc.clientHeight;
          if (!label || label.textContent.trim() !== edge.text || !box || getComputedStyle(label).visibility === "hidden" || box.top < visibleTop - 0.5 || box.bottom > visibleBottom + 0.5) out.dayBoundaryClipped.push(edge.text);
          if (edge.text === "24:00" && label && box) {
            const endLine = sc.querySelector(".lubi-tl-line.is-day-end"), endBox = r(endLine);
            if (!endBox || Math.abs((box.top + box.bottom) / 2 - endBox.top) > 0.75 || box.right >= endBox.left) out.dayBoundaryClipped.push("24:00 must be centered immediately left of its rule");
          }
        }
        sc.scrollTop = 0;
      }
    }
    // Keep the weekly grid end marker visible after scrolling to the configured last hour.
    out.weekEndClipped = [];
    out.weekSchedule = null;
    {
      const sc = document.querySelector(".lubi-week-body");
      if (sc && getComputedStyle(sc).display !== "none") {
        sc.scrollTop = Math.max(0, sc.scrollHeight - sc.clientHeight);
        const end = sc.querySelector(".lubi-week-hour.is-day-end"), box = r(end), frame = r(sc);
        const visibleTop = frame.top + sc.clientTop, visibleBottom = visibleTop + sc.clientHeight;
        const columns = [...sc.querySelectorAll(".lubi-week-col")];
        const endLines = [...sc.querySelectorAll(".lubi-week-line.is-day-end")];
        if (!end || end.textContent.trim() !== "24:00" || !box || getComputedStyle(end).visibility === "hidden" || box.top < visibleTop - 0.5 || box.bottom > visibleBottom + 0.5 || endLines.length !== columns.length || endLines.some((line, i) => line.style.top !== columns[i]?.style.height)) out.weekEndClipped.push("24:00");
        if(frame.width>0){
          const card=sc.closest('.lubi-week-card'),panelCss=getComputedStyle(sc).getPropertyValue('--lubi-panel-height').trim();
          const panel=panelCss.endsWith('vh')?parseFloat(panelCss)*innerHeight/100:(parseFloat(panelCss)||840);
          const hours=sc.querySelector('.lubi-week-hours'),firstColumn=sc.querySelector('.lubi-week-col');
          const hourLines=[...firstColumn.querySelectorAll('.lubi-week-line:not(.is-half):not(.is-day-end)')];
          out.weekSchedule={viewport:sc.clientHeight,expectedViewport:Math.min(Math.max(320,panel-270),parseFloat(hours.style.height)),footerGap:r(card).bottom-frame.bottom,endLabelGap:r(card).bottom-box.bottom,hourStep:r(hourLines[1]).top-r(hourLines[0]).top};
        }
        sc.scrollTop = 0;
      }
    }
    // The midnight line and plan lane start below a visible top gutter.
    out.dayTopInset = null;
    {
      const sc = document.querySelector(".lubi-timeline-scroll");
      const timeline = sc?.querySelector(".lubi-timeline"), line = timeline?.querySelector(".lubi-tl-line.is-first"), label = timeline?.querySelector(".lubi-hour-label.is-day-start");
      if (sc && timeline && line && label) {
        sc.scrollTop = 0;
        const frame = r(sc), grid = r(timeline);
        out.dayTopInset = grid.top - frame.top - sc.clientTop;
        out.midnightLineOffset = r(line).top - grid.top;
        out.midnightLabelOffset = r(label).top - grid.top;
        out.paddingTop = parseFloat(getComputedStyle(sc).paddingTop) || 0;
        const planTitle = timeline.querySelector(".lubi-plan-lane-title");
        const qaPlan = [...timeline.querySelectorAll(".lubi-plan")].find(plan => plan.querySelector(".lubi-plan-title")?.textContent === "午夜计划（布局回归）");
        out.planHandleErrors = [];
        for (const plan of timeline.querySelectorAll('.lubi-plan')) {
          const top = plan.querySelector('.lubi-block-handle.is-top'), bottom = plan.querySelector('.lubi-block-handle.is-bottom');
          if (!top || !bottom) { out.planHandleErrors.push('missing handle'); continue; }
          const center = el => {
            const box = r(el), cs = getComputedStyle(el, '::after');
            return box.left + parseFloat(cs.left) + parseFloat(cs.marginLeft) + parseFloat(cs.width)/2;
          };
          if (Math.abs(center(top) - center(bottom)) > 0.5 || Math.abs(center(top) - (r(plan).left+r(plan).right)/2) > 0.5) out.planHandleErrors.push('top/bottom handles must share card center');
          plan.focus({preventScroll:true});
          const actions = [...plan.querySelectorAll('.lubi-block-actions button')];
          if (actions.length !== 2 || plan.querySelector('.lubi-plan-cancel')) out.planHandleErrors.push('plan must use edit/delete actions');
          for (const action of actions) {
            const box = r(action), frame = r(sc);
            const x = (box.left+box.right)/2, y = (box.top+box.bottom)/2;
            if (y >= frame.top && y <= frame.bottom && x >= 0 && x < innerWidth && y >= 0 && y < innerHeight && !action.contains(document.elementFromPoint(x,y))) out.planHandleErrors.push('resize handle intercepts action button');
          }
          plan.blur();
        }
        out.dayPlanTitleOffset = planTitle ? r(planTitle).top - grid.top : null;
        out.dayPlanBlockOffset = qaPlan ? r(qaPlan).top - grid.top : null;
        out.dayPlanTitleGap = planTitle && qaPlan ? r(qaPlan).top - r(planTitle).bottom : null;
        out.dayStartGutterPx = parseFloat(timeline.style.getPropertyValue("--lubi-day-start-gutter")) || 0;
        out.hourPx = r(timeline.querySelector(".lubi-tl-canvas")).height / 24;
      }
    }
    // Region geometry uses the real CSS in both themes and narrow/wide views.
    const hoverCol=document.querySelector('[data-hover-probe-y]');
    if(hoverCol) {
      const line=hoverCol.querySelector('.lubi-week-hover'),label=document.querySelector('.lubi-week-hover-label');
      const rect=r(hoverCol),y=Number(hoverCol.dataset.hoverProbeY),scale=rect.height/parseFloat(hoverCol.style.height);
      const expected=rect.top+y*scale,lineRect=r(line),labelRect=r(label);
      out.planningHover={height:rect.height,lineHeight:lineRect.height,error:Math.abs(lineRect.top+lineRect.height/2-expected),labelError:Math.abs(labelRect.top+labelRect.height/2-expected),cursor:getComputedStyle(hoverCol).cursor,on:line.classList.contains('is-on')};
    }
    const areaCanvas = document.querySelector('.lubi-tl-canvas');
    if (areaCanvas) {
      const lane = areaCanvas.querySelector('.lubi-plan-lane'), split = lane ? r(lane).left : r(areaCanvas).right;
      const guide = areaCanvas.querySelector(':scope > .lubi-tl-hover'), ghost = areaCanvas.querySelector('.lubi-block-ghost');
      guide.classList.remove('is-drag-guide'); // Ordinary hover/selection stays lane-specific.
      for (const area of lane ? ['record','plan'] : ['record']) {
        for (const el of [guide,ghost]) { el.dataset.area = area; el.classList.add('is-on'); }
        ghost.style.top='400px'; ghost.style.height='60px';
        const ghostStyle=getComputedStyle(ghost),color=ghostStyle.backgroundColor,numbers=(color.match(/[\d.]+/g)||[]).map(Number);
        const alpha=color.startsWith('color(')?(numbers[3]??1):(numbers[3]??1);
        if(alpha<0.999||Number(ghostStyle.opacity)<1||Number(ghostStyle.zIndex)<=3) out.simplifyErrors.push(area+' selection must be opaque above the current-time red line');

        for (const el of [guide,ghost]) {
          const box=r(el);
          if (area==='record' && (Math.abs(box.left-r(areaCanvas).left)>1 || Math.abs(box.right-split)>1)) out.simplifyErrors.push('record hover/selection crosses region divider');
          if (area==='plan' && (Math.abs(box.left-split)>1 || Math.abs(box.right-r(areaCanvas).right)>1)) out.simplifyErrors.push('plan hover/selection crosses region divider');
        }
      }
      for (const el of [guide,ghost]) { el.classList.remove('is-on'); delete el.dataset.area; }
    }
    // WCAG contrast of every visible text node against its nearest opaque background
    const parse = (c) => { const m = (c.match(/[\d.]+/g) || []).map(Number); if (c.startsWith('color(')) { const v = m.slice(0, 3).map((x) => x * 255); if (m.length > 3) v.push(m[3]); return v; } return m; };
    const lum = (rgb) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]); };
    const bgOf = (el) => { while (el) { const bg = getComputedStyle(el).backgroundColor; const m = parse(bg); if (m.length >= 3 && (m.length < 4 || m[3] > 0.9)) return m; el = el.parentElement; } return [255, 255, 255]; };
    out.lowContrast = [];
    const seen = new Set();
    const w2 = document.createTreeWalker(document.querySelector('.lubi-root, .lubi-modal, .lubi-settings'), NodeFilter.SHOW_TEXT);
    while (w2.nextNode()) {
      const t = w2.currentNode; if (!t.nodeValue.trim()) continue;
      const el = t.parentElement; if (!el || el.closest('.lubi-sr-only, script, style, [hidden]')) continue;
      const cs = getComputedStyle(el); const box = el.getBoundingClientRect();
      if (!box.width || cs.visibility === 'hidden' || cs.display === 'none') continue;
      if (el.closest('.is-future, .is-done, [disabled], .lubi-muted-future')) continue; // intentionally de-emphasised
      const fg = parse(cs.color); const bg = bgOf(el); const a = fg.length > 3 ? fg[3] : 1;
      const mix = fg.slice(0, 3).map((v, i) => v * a + bg[i] * (1 - a));
      const L1 = lum(mix), L2 = lum(bg); const cr = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const key = el.className + cs.color;
      if (cr < LUBI_DESIGN.minContrast && !seen.has(key)) { seen.add(key); out.lowContrast.push(cr.toFixed(2) + ' ' + (el.className || el.tagName) + ' "' + t.nodeValue.trim().slice(0, 12) + '"'); }
    }
    out.heatCells = [...document.querySelectorAll(".lubi-heat .lubi-heat-cell:not(.is-out)")].map(el => ({ width:r(el).width, height:r(el).height }));
    // 合成摘要卡片验证共享样式：明暗主题、窄宽度、两行备注与文字对比。
    const hint = document.createElement('div'); hint.className = 'lubi-tip';
    hint.style.cssText = 'left:8px;top:8px;max-width:240px';
    hint.innerHTML = '<div class="lubi-task-tip-title">任务摘要布局夹具</div><div>12:45–13:15 · 预计用时：30分钟</div><div class="lubi-task-tip-notes">长备注 ' + '测试备注内容 '.repeat(50) + '</div>';
    document.body.appendChild(hint);
    const hintBox = r(hint), notes = hint.querySelector('.lubi-task-tip-notes'), notesStyle = getComputedStyle(notes);
    out.tipFits = hintBox.width <= 240.5 && hintBox.right <= innerWidth - 7;
    out.tipNotesClamped = r(notes).height <= parseFloat(notesStyle.lineHeight) * 2 + 1;
    out.tipContrast = Array.from(hint.children).every(el => {
      const fg = parse(getComputedStyle(el).color), bg = bgOf(hint), l1 = lum(fg), l2 = lum(bg);
      return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05) >= LUBI_DESIGN.minContrast;
    });
    out.tipBackground = parse(getComputedStyle(hint).backgroundColor).slice(0,3);
    const tokenSample=document.createElement('span');tokenSample.style.backgroundColor='var(--color-canvas)';document.querySelector('.lubi-root, .lubi-modal, .lubi-settings').append(tokenSample);out.tokenCanvas=parse(getComputedStyle(tokenSample).backgroundColor).slice(0,3);tokenSample.remove();
    hint.remove();
    const label = document.createElement('div'); label.className = 'lubi-tip is-label'; label.textContent = '编辑'; document.body.appendChild(label);
    const labelStyle = getComputedStyle(label);
    out.shortHint = { compact: labelStyle.paddingTop === labelStyle.getPropertyValue('--space-1').trim() && labelStyle.paddingLeft === labelStyle.getPropertyValue('--space-2').trim(), surface: parse(labelStyle.backgroundColor).slice(0,3) };
    label.remove();
    const options = document.querySelector('.lubi-name-options');
    if (options && !options.hidden && options.querySelector(".lubi-name-option")) {
      const input = document.querySelector('[role="combobox"]');
      const rows = [...options.children];
      const rect = r(options), ir = r(input);
      const firstVisible = rows.filter(row => r(row).top >= rect.top && r(row).bottom <= rect.bottom + .5).length;
      options.scrollTop = options.scrollHeight;
      const last = r(rows.at(-1));
      out.nameList = {hidden:options.hidden,count:rows.length,height:options.clientHeight,rows:rows.map(row=>r(row).height),firstVisible,scroll:options.scrollTop,lastVisible:last.top>=rect.top && last.bottom<=rect.bottom+.5,widthAligned:Math.abs(rect.left-ir.left)<1 && Math.abs(rect.right-ir.right)<1,belowInput:rect.top>=ir.bottom,viewportFits:rect.left>=0 && rect.right<=innerWidth && rect.bottom<=innerHeight,overflow:getComputedStyle(options).overflowY};
    }
    const gs=document.querySelector('.lubi-gantt-scroll');
    if(gs) {
      const heading=gs.querySelector('.lubi-gantt-heading > .lubi-gantt-name');
      const titles=[...gs.querySelectorAll('.lubi-gantt-title')];
      const rows=[...gs.querySelectorAll('.lubi-gantt-row')],names=rows.map(row=>row.querySelector('.lubi-gantt-name'));
      const flat=names.filter(n=>!n.querySelector('.lubi-gantt-collapse,.lubi-gantt-spacer'));
      const card=gs.closest('.lubi-gantt-card'),cardStyle=getComputedStyle(card);
      const layout={nameWidth:names.every(n=>r(n).width>=140&&r(n).width<=160&&Math.abs(r(n).width-r(heading).width)<=1),normalRows:rows.every(row=>r(row).height>=38&&r(row).height<=39),normalHeader:Math.abs(r(heading).height-44)<=1,flatLeft:flat.length>0&&flat.every(n=>{const offset=r(n.querySelector('.lubi-dot')).left-r(n).left;return offset>=14&&offset<=15}),panelFills:Math.abs(r(card).width-r(card.parentElement).width)<=1,scrollerFills:Math.abs(r(gs).width-(card.clientWidth-parseFloat(cardStyle.paddingLeft)-parseFloat(cardStyle.paddingRight)))<=1,tableFills:r(gs.querySelector('.lubi-gantt-table')).width>=gs.clientWidth-1,barInside:[...gs.querySelectorAll('.lubi-gantt-bar')].every(b=>r(b).top>=r(b.closest('.lubi-gantt-row')).top&&r(b).bottom<=r(b.closest('.lubi-gantt-row')).bottom)};
      const done=[...gs.querySelectorAll('.lubi-gantt-bar.is-done')],todo=gs.querySelector('.lubi-gantt-bar:not(.is-done)');
      const expectedFill=(bar,percent)=>{const probe=document.createElement('span');probe.style.backgroundColor='color-mix(in srgb, var(--chip) '+percent+'%, '+(percent===60?'var(--text-normal)':'var(--background-primary)')+')';bar.appendChild(probe);const value=getComputedStyle(probe).backgroundColor;probe.remove();return value;};
      out.ganttAppearance={layout,center:getComputedStyle(heading).justifyContent==='center',left:titles.every(el=>getComputedStyle(el).textAlign==='left'),categoryFill:!!todo&&done.length>0&&done.every(el=>getComputedStyle(el).backgroundColor===expectedFill(el,60))&&getComputedStyle(todo).backgroundColor===expectedFill(todo,18),noLeftStripe:done.every(el=>parseFloat(getComputedStyle(el).borderLeftWidth)===0)};
    }
    if(gs&&!document.querySelector(".lubi-daily-gantt-card")) {
      const names=[...gs.querySelectorAll('.lubi-gantt-row > .lubi-gantt-name')],header=gs.querySelector('.lubi-gantt-heading'),dates=header.querySelector('.lubi-gantt-dates');
      const table=gs.querySelector('.lubi-gantt-table'),rows=[...gs.querySelectorAll('.lubi-gantt-row')];
      const widths=rows.map(row=>Math.abs(r(row.querySelector('.lubi-gantt-track')).width-r(dates).width));
      const before=names[0]?r(names[0]).left:null;
      gs.scrollLeft=180;gs.scrollTop=60;
      const sticky=names[0]?Math.abs(r(names[0]).left-before):0;
      const corner=header.querySelector('.lubi-gantt-name'),cornerHit=document.elementFromPoint(Math.max(1,r(corner).left+10),Math.max(1,r(header).top+10));
      out.gantt={needsScroll:gs.scrollWidth>gs.clientWidth+1,visible:r(gs).width>0&&r(gs).height>0,days:dates.children.length,overflow:document.documentElement.scrollWidth-innerWidth,scroll:gs.scrollLeft,sticky,headerSticky:Math.abs(r(header).top-r(gs).top-1)<=1,nameOverflow:names.some(n=>n.scrollWidth>n.clientWidth+1),aligned:widths.every(w=>w<=1),rows:rows.length,switches:[...document.querySelectorAll('.lubi-schedule-switch')].filter(e=>r(e).width>0&&r(e).height>0).length,actualExcluded:!gs.querySelector('[data-task-id="layout-gantt-record"]'),childVisible:!!gs.querySelector('[data-task-id="layout-gantt-child"]'),cornerAbove:!cornerHit||!!cornerHit.closest('.lubi-gantt-heading'),lineCount:gs.querySelectorAll('.lubi-gantt-today').length};
    }
    const daily=document.querySelector('.lubi-daily-gantt-card');
    if(daily) {
      const sc=daily.querySelector('.lubi-gantt-scroll'),axis=daily.querySelector('.lubi-daily-gantt-axis'),ticks=[...axis.querySelectorAll('.lubi-daily-gantt-tick')],plots=[...daily.querySelectorAll('.lubi-daily-gantt-plot')];
      const center=e=>r(e).left+r(e).width/2;
      const first=r(ticks[0]),last=r(ticks.at(-1)),ar=r(axis);
      const name=daily.querySelector('.lubi-gantt-row .lubi-gantt-name'),left=r(name).left;
      const endpoints=plots.every(p=>Math.abs(r(p).left-center(ticks[0]))<=.75&&Math.abs(r(p).right-center(ticks.at(-1)))<=.75);
      const overlap=ticks.some((t,i)=>i>0&&r(ticks[i-1]).right>r(t).left+.5);
      sc.scrollLeft=150;
      out.dailyGantt={ticks:ticks.length,first:ticks[0].textContent,last:ticks.at(-1).textContent,firstHeader:daily.querySelector('.lubi-gantt-table').firstElementChild.classList.contains('lubi-gantt-heading'),visible:r(sc).width>0,contained:first.left>=ar.left&&last.right<=ar.right,endpoints,overlap,sticky:Math.abs(r(name).left-left)<=1,needsScroll:sc.scrollWidth>sc.clientWidth+1,scroll:sc.scrollLeft,overflow:document.documentElement.scrollWidth-innerWidth,untimedNoBar:!daily.querySelector('[data-task-id="layout-daily-unset"] .lubi-gantt-bar'),point:daily.querySelector('[data-task-id="layout-daily-point"] .lubi-gantt-bar')?.dataset.minutes==='0',completedPlain:daily.querySelectorAll('.lubi-gantt-row.is-done .lubi-gantt-title').length>0&&[...daily.querySelectorAll('.lubi-gantt-row.is-done .lubi-gantt-title')].every(el=>!getComputedStyle(el).textDecorationLine.includes('line-through')),completedNoCheck:[...daily.querySelectorAll('.lubi-gantt-row.is-done .lubi-gantt-title,.lubi-gantt-row.is-done .lubi-gantt-bar-label')].every(el=>!el.textContent.includes('✓'))};
    }
    document.getElementById('lubi-result').textContent = 'LUBI_TOPBAR:' + encodeURIComponent(JSON.stringify(out));
    if(parent!==window)parent.postMessage({type:'lubi-geometry',value:out},'*');
  })();
  </script>`;

  const tmp = mkdtempSync(join(tmpdir(), "lubi-topbar-layout-"));
  try {
    const run = (theme, page, width, expanded = false) => {
      const src = join(project, "preview", theme === "dark" ? "dark" : "", `${page}.html`);
      const expand = expanded ? '<script>document.querySelectorAll(".lubi-fold").forEach(d => d.open = true);</script>' : "";
      const html = readFileSync(src, "utf8").replace("</body>", `${expand}${probe}</body>`);
      const child = join(tmp, `${theme}-${page}-${width}-child.html`);
      writePage(child, html, "utf8");
      const file = join(tmp, `${theme}-${page}-${width}.html`);
      // New headless Chrome may enforce a minimum outer-window width. An exact-size frame gives a verified CSS viewport.
      writePage(file, `<!doctype html><html><head><style>html,body{margin:0;padding:0}iframe{display:block;border:0;width:${width}px;height:900px}</style><script>addEventListener('message',e=>{if(e.data?.type==='lubi-geometry')document.getElementById('lubi-outer-result').textContent='LUBI_TOPBAR:'+encodeURIComponent(JSON.stringify(e.data.value)).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16));});</script></head><body><pre id="lubi-outer-result" style="display:none"></pre><iframe src="${pathToFileURL(child).href}"></iframe></body></html>`, "utf8");
      const result = spawnSync(browser, [
        "--headless=new", "--disable-gpu", "--disable-extensions", "--no-first-run",
        "--no-default-browser-check", "--disable-background-networking", "--hide-scrollbars",
        `--window-size=${width},900`, `--user-data-dir=${join(tmp, `profile-${theme}-${page}-${width}`)}`,
        "--virtual-time-budget=1000", "--dump-dom", pathToFileURL(file).href,
      ], { encoding: "utf8", timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
      assert.equal(result.status, 0, `headless browser failed: ${result.error || result.stderr?.slice(-500)}`);
      const matches = [...result.stdout.matchAll(/LUBI_TOPBAR:([A-Za-z0-9%._~-]+)/g)];
      assert(matches.length > 0, `browser did not return geometry for ${page}`);
      const geometry = JSON.parse(decodeURIComponent(matches[matches.length - 1][1]));
      assert(!geometry.browserError, `browser probe error for ${page}: ${geometry.browserError} ${geometry.browserStack || ""}`);
      assert.equal(geometry.viewportWidth, width, `browser CSS viewport must really be ${width}px`);
      if (geometry.tabOrder !== null) { assert.equal(geometry.tabOrder,"seg:tasks|seg:review", "all pages share the new top tab order"); assert.deepEqual(geometry.tabLabels.map(label=>label.text),["计划","回顾"]); assert(geometry.tabLabels.every(label=>label.visible), "both top-level labels remain visible on narrow panels"); }
      if (geometry.ganttAppearance) assert(Object.values(geometry.ganttAppearance.layout).every(Boolean), `${theme} ${page} ${width}px: shared compact name column with full-width normal layout ${JSON.stringify(geometry.ganttAppearance.layout)}`);
      return geometry;
    };
    for (const theme of ["light", "dark"]) {
      for (const width of [1400, 1000, 720, 390]) {
        const xs = {};
        for (const page of ["today", "review", "tasks"]) {
          const g = run(theme, page, width);
          xs[page] = g.tabsX;
          assert.equal(g.primaryActions, page === "review" ? 0 : 1, `${theme} ${page}: primary action only on planning`);
          assert.equal(g.newTaskVisible, page !== "review", `${theme} ${page}: new task visible only on planning`);
          assert(g.aiEntry&&g.aiEntry.secondary&&g.aiEntry.named&&g.aiEntry.icon, `${theme} ${page}: AI button retains name and secondary style`);
          assert(g.jsonEntry&&g.jsonEntry.secondary&&g.jsonEntry.named,"JSON import has a secondary named button");
          if(page==="review")assert(!g.aiEntry.visible&&!g.jsonEntry.visible,"review does not gain creation entries");else {assert(g.jsonEntry.visible&&g.jsonEntry.left&&g.jsonEntry.inside,"JSON import is visible left of AI");assert(g.aiEntry.visible&&g.aiEntry.left&&g.aiEntry.inside,`${theme} ${width}px: AI button stays visible left of new task without clipping`);}
          assert.deepEqual(g.simplifyErrors, [], `${theme} ${page}: simplified UI regression ${g.simplifyErrors.join(", ")}`);
          assert(g.foldStates.every(d => ((d.planTasks || d.gaps) ? d.open : !d.open) && d.summaryVisible), `${theme} ${page}: task list and gaps are open while secondary sections remain reachable`);
          if ([1400, 390].includes(width) && page !== "tasks") {
            const expanded = run(theme, page, width, true);
            assert((page !== "review" || expanded.foldStates.length > 0) && expanded.foldStates.every(d => d.open && d.summaryVisible), `${theme} ${page}: folded content expands`);
            assert.deepEqual(expanded.lowContrast, [], `${theme} ${page} expanded ${width}px: text contrast below 4.5:1 ${expanded.lowContrast.join("; ")}`);
            assert(expanded.minFont >= DESIGN.minFontPx, `${theme} ${page} expanded: minimum font size`);
          }
          if(page==='review') {
            assert(g.reviewHeader?.sameRow&&g.reviewHeader.gap>=0&&g.reviewHeader.gap<=16,theme+' '+width+'px: chart/table switch must stay next to its title '+JSON.stringify(g.reviewHeader));
            if(g.reviewBarStates.zero)assert(!g.reviewBarStates.zero.outline&&g.reviewBarStates.zero.height<=.5&&g.reviewBarStates.zero.badge,'zero today keeps the date badge but no false bar outline');
            if(g.reviewBarStates.filled)assert(g.reviewBarStates.filled.outline&&g.reviewBarStates.filled.height>0&&g.reviewBarStates.filled.badge,'nonzero today retains its existing highlight');
          }
          assert(!g.reviewCreationError, g.reviewCreationError);
          assert(g.barOverflow <= 1, `${theme} ${page} ${width}px: top bar overflows by ${g.barOverflow}px`);
          if(width<=560&&g.dateCaption)assert(g.dateCaption.oneLine&&g.dateCaption.contained,`${theme} ${width}px: date caption stays one line and inside its button`);
          assert(!g.zoneOverlap, `${theme} ${page} ${width}px: top bar zones overlap ${JSON.stringify(g)}`);
          assert(g.referenceControls.every(c => c.stable && c.selected && Math.max(...c.heights) - Math.min(...c.heights) <= .5), `${theme} ${page} ${width}px: shared segments jump or have duplicate emphasis`);
          if (g.planProgress) {
            const p = g.planProgress;
            assert(p.done >= 0 && p.done <= p.total && Math.abs(p.ratio - p.done / p.total) < .011 && p.height === 8 && p.label === `${p.done}/${p.total} 已完成`, `${theme} ${width}px: daily progress must reflect the existing completion count`);
          }
          assert(g.planMetaAligned !== false && g.shortHint.compact, `${theme} ${page} ${width}px: metadata alignment or compact hint regressed: ${JSON.stringify({aligned:g.planMetaAligned,hint:g.shortHint})}`);
          assert.deepEqual(g.shortHint.surface, g.tokenCanvas, `${theme}: compact hints must follow the theme`);
          assert(g.tipFits && g.tipNotesClamped && g.tipContrast, `${theme} ${page} ${width}px: tooltip geometry, two-line notes, or contrast failed ${JSON.stringify(g)}`);
          assert.deepEqual(g.tipBackground, g.tokenCanvas, `${theme}: tooltip should use the theme panel surface`);
          assert(g.minFont >= DESIGN.minFontPx, `${theme} ${page} ${width}px: text below 11px (${g.minFont}px at ${g.minAt})`);
          assert.deepEqual(g.lowContrast, [], `${theme} ${page} ${width}px: text contrast below 4.5:1: ${g.lowContrast.join("; ")}`);
          if(g.weekSchedule){
            const w=g.weekSchedule;
            assert(Math.abs(w.viewport-w.expectedViewport)<=1&&w.footerGap>=12&&w.endLabelGap>=12&&Math.abs(w.hourStep-56)<=.5,theme+' '+width+'px: week schedule bottom extension must preserve its hour scale and 24:00 '+JSON.stringify(w));
          }
          assert.deepEqual(g.weekEndClipped, [], `${theme} ${page} ${width}px: clipped weekly 24:00 boundary ${g.weekEndClipped.join(", ")}`);
          if (page === "today") {
            assert.deepEqual(g.planHandleErrors, [], `${theme} ${width}px: plan resize handles are misaligned: ${g.planHandleErrors.join("; ")}`);
            assert(Math.abs(g.dayTopInset) <= 0.5 && g.paddingTop === 0, `${theme} ${width}px: move the 00:00 origin inside the grid, not the whole scroller ${JSON.stringify(g)}`);
            assert(g.dayStartGutterPx === 32 && Math.abs(g.midnightLineOffset - 32) <= 0.5 && Math.abs(g.midnightLabelOffset - 32) <= 0.5, `${theme} ${width}px: reserve the 24px plan-title row above 00:00 ${JSON.stringify(g)}`);
            assert(g.dayPlanTitleGap >= 0, `${theme} ${width}px: midnight plan card overlaps the sticky plan title ${JSON.stringify(g)}`);
            assert(Math.abs(g.dayPlanTitleOffset) <= 0.5, `${theme} ${width}px: plan title should live in the header row ${JSON.stringify(g)}`);
            assert(Math.abs(g.dayPlanBlockOffset - (g.dayStartGutterPx + 5 * g.hourPx / 60)) <= 0.5, `${theme} ${width}px: a 00:05 plan should stay on its real time line ${JSON.stringify(g)}`);
          }
          assert.deepEqual(g.dayBoundaryClipped, [], `${theme} ${page} ${width}px: clipped daily boundary labels ${g.dayBoundaryClipped.join(", ")}`);
          assert.deepEqual(g.clipped, [], `${theme} ${page} ${width}px: first hour label clipped: ${g.clipped.join("; ")}`);
        }
        const values = Object.values(xs);
        assert(Math.max(...values) - Math.min(...values) <= 1, `${theme} ${width}px: tab switcher moves between pages ${JSON.stringify(xs)}`);
        console.log(`ok   top bar ${theme} ${width}px: tabs x=${values[0]} on all pages, text ≥11px, contrast ≥4.5:1, no clipped hour labels`);
      }
    }
    for(const theme of ["light","dark"]) for(const width of [1400,760,390]) for(const area of ["record","plan"]) for(const mode of ["move","resize-start","resize-end"]) {
      const g=run(theme,"today-drag-"+area+(mode==="move"?"":"-"+mode),width),d=g.dragFeedback;
      assert(d?.visible&&d.contained&&d.leftOfAxis&&d.aligned&&d.guideToAxis&&d.cardGuideVisible&&d.scrollSynced&&d.boundaries&&d.offscreenHidden&&d.fullText&&d.singleLine&&d.inlineHidden&&d.noTextOverlap&&d.area===area,theme+" "+width+"px "+area+" "+mode+": axis-aligned drag feedback and guide without clipping or text overlap "+JSON.stringify(d));
      console.log("ok   drag feedback "+theme+" "+width+"px "+area+" "+mode+": aligned ruler feedback, boundaries and scrolling");
    }
    for(const theme of ["light","dark"]) for(const width of [1560,1000,760,390]) {
      const g=run(theme,"tasks-daily-gantt",width),d=g.dailyGantt;
      assert(d?.visible&&d.ticks===25&&d.first==="00:00"&&d.last==="24:00"&&d.firstHeader&&d.contained&&d.endpoints&&!d.overlap&&d.sticky&&(!d.needsScroll||d.scroll>0)&&d.overflow<=1&&d.untimedNoBar&&d.point&&d.completedPlain&&d.completedNoCheck&&g.ganttAppearance.center&&g.ganttAppearance.left&&g.ganttAppearance.categoryFill&&g.ganttAppearance.noLeftStripe,`${theme} ${width}px: daily time axis/rows/scrolling failed ${JSON.stringify(d)}`);
      assert(g.primaryActions===1&&g.minFont >= DESIGN.minFontPx&&g.lowContrast.length===0,`${theme} ${width}px: daily Gantt readability/primary action failed ${JSON.stringify(g.lowContrast)}`);
      console.log(`ok   Daily Gantt ${theme} ${width}px: first-row 00:00–24:00, aligned bars, sticky names, internal scrolling`);
    }
    for(const theme of ["light","dark"]) for(const width of [1560,390]) {
      const g=run(theme,"tasks-week-gantt",width),a=g.gantt;
      assert(a?.visible&&a.days===7&&a.overflow<=1&&a.sticky<=1&&a.aligned&&a.switches===1&&g.ganttAppearance.center&&g.ganttAppearance.left&&g.ganttAppearance.categoryFill&&g.ganttAppearance.noLeftStripe,`${theme} ${width}px: natural-week Gantt layout failed ${JSON.stringify(a)}`);
      console.log(`ok   Week Gantt ${theme} ${width}px: seven natural days, one entry`);
    }
    for(const theme of ["light","dark"]) for(const width of [1560,1180,1000,760,390]) {
      const g=run(theme,"tasks-gantt",width),a=g.gantt;
      assert(a?.visible && a.days>=28&&a.days<=31 && a.rows>5 && a.overflow<=1 && (!a.needsScroll||a.scroll>0) && a.sticky<=1 && a.headerSticky && !a.nameOverflow && a.aligned && a.switches===1 && a.actualExcluded && a.childVisible && a.lineCount>0&&g.ganttAppearance.center&&g.ganttAppearance.left&&g.ganttAppearance.categoryFill&&g.ganttAppearance.noLeftStripe,`${theme} ${width}px: Gantt layout/sticky columns/data projection failed ${JSON.stringify(a)}`);
      assert(g.primaryActions===1 && g.minFont >= DESIGN.minFontPx && g.lowContrast.length===0,`${theme} ${width}px: Gantt has one main action and readable text ${JSON.stringify(g.lowContrast)}`);
      const collapsed=run(theme,"tasks-gantt-collapsed",width).gantt;
      assert(collapsed.visible&&!collapsed.childVisible&&collapsed.rows<a.rows,`${theme} ${width}px: collapsed children still visible`);
      console.log(`ok   Gantt ${theme} ${width}px: natural month, sticky names/header, internal scrolling, no page overflow, expandable hierarchy`);
    }
    for(const theme of ["light","dark"]) for(const width of [1400,1000,900]) {
      const g=run(theme,"tasks-hover",width);
      assert(g.planningHover?.on && g.planningHover.height>0 && g.planningHover.lineHeight>0 && g.planningHover.cursor==="crosshair" && g.planningHover.error<=.75 && g.planningHover.labelError<=.75,`${theme} ${width}px: crosshair, guide stroke and time label must align ${JSON.stringify(g.planningHover)}`);
      console.log(`ok   planning crosshair ${theme} ${width}px: exact guide and label alignment`);
    }
    for (const theme of ["light", "dark"]) for (const width of [1000, 600, 390]) for (const kind of ["record", "task"]) {
      const g=run(theme, `names-${kind}`, width);
      const n=g.nameList;
      assert(n && !n.hidden && n.count>=8 && n.height===180 && n.rows.every(h=>Math.abs(h-36)<.5) && n.firstVisible===5 && n.scroll>0 && n.lastVisible && n.widthAligned && n.belowInput && n.viewportFits && n.overflow==="auto", `${theme} ${kind} ${width}px: five-row internal scrolling history list ${JSON.stringify(n)}`);
      assert(g.minFont >= DESIGN.minFontPx && g.lowContrast.length===0, `${theme} ${kind}: readable history candidates`);
      console.log(`ok   history list ${theme} ${kind} ${width}px: five visible rows, internal scrolling, aligned and unclipped`);
    }
    for(const theme of ['light','dark']) for(const width of [1000,600,390]) {
      const g=run(theme,'modal-actual',width),a=g.unifiedActual;
      assert(a&&a.modes.join('|')==='seg:todo|seg:money'&&a.duration==='60'&&a.comparison.includes('预计 45min · 实际 1h · 超出 15min')&&a.inputsFit&&a.overflow<=1,theme+' '+width+'px: unified actual form layout '+JSON.stringify(a));
      assert(g.minFont >= DESIGN.minFontPx&&g.lowContrast.length===0,theme+' '+width+'px: unified actual form readability');
      console.log('ok   unified actual form '+theme+' '+width+'px: two modes, actual/estimate comparison, visible controls');
    }
    for(const theme of ['light','dark'])for(const width of [1000,600,390,320]) {
      const g=run(theme,'modal-json-import',width),m=g.jsonModal;assert(m&&m.textVisible&&m.inside&&m.overflow<=1&&m.buttons.length===2&&m.buttons.every(b=>b.visible),theme+' '+width+'px: JSON paste/import modal is usable '+JSON.stringify(m));assert(g.minFont >= DESIGN.minFontPx&&g.lowContrast.length===0,'JSON import text is readable');console.log('PASS JSON import modal: '+theme+' '+width+'px');
    }
    for(const theme of ['light','dark'])for(const width of [1000,600,390,320])for(const page of ['modal-new-actual-only','modal-new-planned']) {
      const g=run(theme,page,width),d=g.newTaskDetails;
      assert(d&&d.visible&&!d.summary&&d.inputsFit&&!d.hintVisible&&!d.hint&&!d.removedInstruction,theme+' '+width+'px '+page+': same expanded actual-time fields without redundant hints '+JSON.stringify(d));
      assert(g.locationField.ordered&&g.locationField.fits&&g.locationField.named,theme+" "+width+"px: optional location follows repeat and fits before divider");
      const order=g.taskFieldOrder;
      assert.deepEqual(order.plan,['计划开始日期','计划开始时间','预计用时'],theme+' '+width+'px: planning order');
      assert.deepEqual(order.actual,['实际开始日期','实际开始时间','实际用时'],theme+' '+width+'px: actual order');
      assert(order.planPair&&order.actualPair&&order.actualBelow,theme+' '+width+'px: date/time pairs and duration below');
      assert(g.unifiedActual.inputsFit&&g.unifiedActual.overflow<=1&&g.minFont >= DESIGN.minFontPx&&g.lowContrast.length===0,theme+' '+width+'px '+page+': shared new-task modal stays readable');
      console.log('PASS shared new-task modal: '+theme+' '+width+'px '+page);
    }
    for(const theme of ['light','dark'])for(const width of [1000,600,390,320]) {
      const g=run(theme,'modal-project',width),p=g.projectForm;
      assert(p&&p.fit&&!p.overlap&&p.named&&p.value&&p.overflow<=1,theme+' '+width+'px: project picker and inline creation fit '+JSON.stringify(p));
      assert(g.minFont >= DESIGN.minFontPx&&g.lowContrast.length===0,theme+' '+width+'px: project form readable');
      console.log('PASS project form: '+theme+' '+width+'px, selected project, inline create, labels and no clipping');
    }
    for(const theme of ['light','dark']) for(const width of [1400,390]) {
      const g=run(theme,'today-empty',width),d=g.emptyDonut;
      assert(d?.width===120&&d.height===120&&d.contained&&d.center==='0h'&&d.sub==='覆盖 0%'&&d.circles===1&&d.slices===0&&d.baseVisible&&d.cardOverflow<=1,theme+' '+width+'px: empty distribution ring missing, clipped or filled with fake slices '+JSON.stringify(d));
      assert(g.minFont >= DESIGN.minFontPx&&g.lowContrast.length===0&&g.simplifyErrors.length===0,theme+' '+width+'px: empty donut readability and sidebar structure');
      console.log('ok   empty donut '+theme+' '+width+'px: neutral ring, zero center, no slices or clipping');
    }
    for(const theme of ['light','dark']) for(const width of [1400,390]) for(const [period,count] of [['week',7],['month',29],['year',12]]) {
      const g=run(theme,'review-empty-'+period,width),e=g.emptyReview;
      assert(e?.metrics&&e.details&&e.chartHeight>=180&&e.gridHeight>=180&&e.buckets===count&&e.zeroBars&&!e.invalid&&e.bodyOverflow<=1,theme+' '+period+' '+width+'px: empty review chart and structure '+JSON.stringify(e));
      assert(g.reviewHeader?.sameRow&&g.reviewHeader.gap>=0&&g.reviewHeader.gap<=16,theme+' '+period+' '+width+'px: empty chart controls shifted away from their title '+JSON.stringify(g.reviewHeader));
      assert(g.reviewBarStates.zero?.height<=.5&&!g.reviewBarStates.zero.outline&&g.reviewBarStates.zero.badge,'empty today keeps its date badge without drawing a zero-height bar outline');
      assert(g.minFont >= DESIGN.minFontPx&&g.lowContrast.length===0&&g.barOverflow<=1,theme+' '+period+' '+width+'px: empty review readability or overflow');
      if(period==='year')assert(g.heatCells.length===366&&g.heatCells.every(cell=>cell.width>0&&Math.abs(cell.width-cell.height)<=.75),'empty leap year heatmap remains visible and square');
      console.log('ok   empty review '+theme+' '+period+' '+width+'px: zero buckets, visible chart, details, no overflow');
    }
    for (const theme of ["light", "dark"]) for (const width of [1560, 1000, 600, 390]) {
      const g = run(theme, "review-year", width);
      assert(g.heatCells.length >= 365 && g.heatCells.every(cell => cell.width > 0 && Math.abs(cell.width - cell.height) <= 0.75), `${theme} ${width}px: heatmap date cells must remain square ${JSON.stringify(g.heatCells.slice(0, 3))}`);
      console.log(`ok   heatmap squares ${theme} ${width}px: ${g.heatCells.length} dates`);
    }
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* Chrome may briefly hold its temp profile on Windows. */ }
  }
}
