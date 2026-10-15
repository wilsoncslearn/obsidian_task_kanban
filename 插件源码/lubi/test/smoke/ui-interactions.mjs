import assert from 'node:assert/strict';
import * as O from '../helpers/mock-obsidian.js';
import Module from 'node:module';
import { createRequire } from 'node:module';
const orig=Module._load;Module._load=function(req,...a){return req==='obsidian'?O:orig.call(this,req,...a)};
const Plugin=createRequire(import.meta.url)(process.env.LUBI_TEST_PLUGIN||'../.out/plugin.cjs').default;
const app=new O.App(),plugin=new Plugin(app,{id:'lubi',version:'1.6.0'});await plugin.onload();await plugin.tasks.load();
const tick=()=>new Promise(r=>setTimeout(r,60));let failures=0;
const check=(value,message)=>{console.log((value?'ok  ':'FAIL ')+message);if(!value)failures++};
const D='2026-09-24';
const {blankTask}=await import('../.out/core.mjs');await plugin.tasks.upsert(blankTask({id:'history-candidate',title:'可主动选择的历史任务',category:'学习'}));let Record;
const view=await plugin.activateView('today',D);await tick();const root=view.contentEl;
// Approved quiet controls retain accessible names, including nested icon events inside a detail card.
const quietCases = [
 ['lubi-root','<button class="lubi-quiet-action"></button>'],
 ['lubi-modal','<div class="lubi-kind-seg"><button></button></div>'],
 ['lubi-root','<div class="lubi-plan-progress" role="progressbar" tabindex="0"></div>'],
 ['lubi-settings','<div class="lubi-quiet-action checkbox-container" tabindex="0"></div>'],
 ['lubi-root','<button class="lubi-gantt-collapse"></button>'],
 ['lubi-root','<div class="lubi-review"><div class="lubi-toolbar"><div class="lubi-nav"><button class="lubi-icon-btn"></button></div></div></div>'],
 ['lubi-settings','<button class="lubi-model-toggle"></button>'],
 ['lubi-root','<button class="lubi-task-group-title"></button>'],
 ['lubi-modal','<button class="lubi-cat-option"></button>'],
 ['lubi-modal','<button class="lubi-quick-chip-warn lubi-switch"></button>'],
 ['lubi-settings','<button class="lubi-category-up"></button>'],
 ['lubi-settings','<button class="lubi-category-remove"></button>'],
 ['lubi-root','<button class="lubi-gap-row-add"></button>'],
];
for(const [scope,html] of quietCases) {
 const host=document.body.createDiv({cls:scope}),parent=host.createDiv({attr:{'aria-label':'父级详情'}});
 parent.innerHTML=html;const control=parent.querySelector('button,[tabindex]');control.setAttribute('aria-label','可访问操作名称');control.createSpan({cls:'probe-icon'});
 await tick();const target=control.querySelector('.probe-icon');target.dispatchEvent(new window.MouseEvent('pointermove',{bubbles:true,clientX:200,clientY:30,buttons:0}));await new Promise(r=>setTimeout(r,300));
 check(!document.querySelector('.lubi-tip'),'quiet nested icon does not open own or parent hint: '+html);
 control.focus();await tick();check(!document.querySelector('.lubi-tip'),'quiet keyboard focus: '+html);control.blur();
 check(!control.hasAttribute('title')&&!control.hasAttribute('aria-label')&&!control.hasAttribute('data-lubi-tip')&&document.getElementById(control.getAttribute('aria-labelledby'))?.textContent==='可访问操作名称','quiet control keeps accessible name: '+html);
 parent.dispatchEvent(new window.MouseEvent('pointermove',{bubbles:true,clientX:200,clientY:30,buttons:0}));await new Promise(r=>setTimeout(r,300));
 check(document.querySelector('.lubi-tip')?.textContent==='父级详情','parent detail is preserved outside quiet control: '+html);host.remove();await tick();
}
for(const [cls,hint] of [['lubi-task-start','记录本人实际，可选择完成'],['lubi-task-unlogged','按计划补记待确认记录，不改变完成状态']]) {
 const host=document.body.createDiv({cls:'lubi-root'}),control=host.createEl('button',{cls,attr:{'aria-label':'具体任务的完整操作名称'}});await tick();
 control.focus();await tick();check(document.querySelector('.lubi-tip')?.textContent===hint,'short operational hint: '+cls);control.blur();
 check(document.getElementById(control.getAttribute('aria-labelledby'))?.textContent==='具体任务的完整操作名称','short hint retains full accessible name: '+cls);host.remove();await tick();
}
// Header buttons keep accessible names, but never custom or native tooltips.
for(const button of root.querySelectorAll('.lubi-topbar button, .lubi-planning-head button')) {
 const target=button.querySelector('svg,span')||button;
 target.dispatchEvent(new window.MouseEvent('pointermove',{bubbles:true,clientX:200,clientY:30,buttons:0}));await new Promise(r=>setTimeout(r,300));
 check(!document.querySelector('.lubi-tip'),'header hover remains quiet: '+button.dataset.lubiFocus);
 button.focus();await tick();check(!document.querySelector('.lubi-tip'),'header focus remains quiet: '+button.dataset.lubiFocus);button.blur();
 check(!button.hasAttribute('title')&&!button.hasAttribute('aria-label')&&!button.hasAttribute('data-lubi-tip'),'header has no tooltip attributes: '+button.dataset.lubiFocus);
 const labelled=document.getElementById(button.getAttribute('aria-labelledby'));
 check(!!labelled?.textContent?.trim()||!!button.textContent.trim(),'header keeps its accessible name: '+button.dataset.lubiFocus);
}
// Inbox add is already identified by its plus icon and section heading.
for(const mode of ['calendar','gantt','list']) {
 view.tasksState.scheduleView=mode;view.show('tasks',D);await tick();
 const add=root.querySelector('.lubi-inbox-add');check(!!add,'inbox add exists in '+mode);
 const target=add.querySelector('svg')||add;
 target.dispatchEvent(new window.MouseEvent('pointermove',{bubbles:true,clientX:200,clientY:30,buttons:0}));await new Promise(r=>setTimeout(r,300));
 check(!document.querySelector('.lubi-tip'),'inbox add hover stays quiet in '+mode);
 add.focus();await tick();check(!document.querySelector('.lubi-tip'),'inbox add focus stays quiet in '+mode);add.blur();
 check(!add.hasAttribute('title')&&!add.hasAttribute('aria-label')&&!add.hasAttribute('data-lubi-tip'),'inbox add has no tooltip attributes in '+mode);
 check(document.getElementById(add.getAttribute('aria-labelledby'))?.textContent==='新建未安排任务','inbox add keeps accessible name in '+mode);
 const before=plugin.tasks.all.length;add.click();await tick();const modal=O.openModals.at(-1);
 check(!!modal?.contentEl.querySelector('.lubi-plan-grid'),'inbox add still opens task form in '+mode);
 modal?.close();await tick();check(plugin.tasks.all.length===before,'cancel inbox add writes no task in '+mode);
}
view.tasksState.scheduleView='calendar';view.show('today',D);await tick();
check([...root.querySelectorAll('.lubi-topbar-tabs button')].map(x=>x.dataset.lubiFocus).join('|')==='seg:tasks|seg:review','top tabs are plan/review only');
for(const [i,tab] of [...root.querySelectorAll('.lubi-topbar-tabs button')].entries()) {
  const label=['计划','回顾'][i];
  check(!tab.hasAttribute('data-lubi-tip')&&!tab.hasAttribute('title')&&!tab.hasAttribute('aria-label'),label+' tab has no custom or native hover hint');
  check(document.getElementById(tab.getAttribute('aria-labelledby'))?.textContent===label&&tab.getAttribute('aria-keyshortcuts')===String(i+1),label+' tab retains an explicit accessible name and shortcut');
  tab.dispatchEvent(new window.MouseEvent('pointermove',{bubbles:true,clientX:200,clientY:30,buttons:0}));await new Promise(r=>setTimeout(r,300));
  check(!document.querySelector('.lubi-tip'),label+' tab hover shows no tooltip');
  tab.focus();await tick();check(!document.querySelector('.lubi-tip'),label+' tab focus shows no tooltip');tab.blur();
  tab.click();await tick();check(view.tab===['tasks','review'][i],label+' tab still switches pages');
}

view.tasksState.period='week';view.show('tasks',D);await tick();
const headerDates=[...root.querySelectorAll('.lubi-week-day-button')].map(button=>document.getElementById(button.getAttribute('aria-labelledby')).textContent.match(/\d{4}-\d{2}-\d{2}/)[0]);
check(headerDates.length===7,'week schedule keeps seven date headers');
for(const [i,date] of headerDates.entries()) {
  const button=root.querySelectorAll('.lubi-week-day-button')[i];
  check(button.isConnected&&!button.hasAttribute('data-lubi-tip')&&!button.hasAttribute('title')&&!button.hasAttribute('aria-label'),'week header '+i+' has no custom or native hover hint');
  check(document.getElementById(button.getAttribute('aria-labelledby'))?.textContent.includes(date),'week header '+i+' retains its full-date accessible name');
  button.dispatchEvent(new window.MouseEvent('pointermove',{bubbles:true,clientX:200,clientY:30,buttons:0}));await new Promise(r=>setTimeout(r,300));
  check(!document.querySelector('.lubi-tip'),'week header '+i+' hover shows no tooltip');
  button.focus();await tick();check(!document.querySelector('.lubi-tip'),'week header '+i+' focus shows no tooltip');button.blur();
  button.click();await tick();await tick();check(view.tasksState.selectedDate===date&&root.querySelectorAll('.lubi-week-day-button')[i].getAttribute('aria-current')==='date','week header '+i+' still selects the date without shifting the week');
}
await plugin.tasks.upsert(blankTask({id:'quiet-header-drop',title:'合成表头排期任务',category:'学习'}));await tick();
const headerDrop=root.querySelectorAll('.lubi-week-day-button')[3].closest('.lubi-week-day');
const headerTransfer={types:['text/lubi-task'],dropEffect:'',getData:type=>type==='text/lubi-task'?'quiet-header-drop':''};
for(const type of ['dragover','drop']) { const event=new window.Event(type,{bubbles:true,cancelable:true});Object.defineProperty(event,'dataTransfer',{value:headerTransfer});headerDrop.dispatchEvent(event);if(type==='dragover')check(event.defaultPrevented&&headerDrop.classList.contains('is-drop'),'quiet week header still accepts task dragover');await tick();await tick(); }
check(plugin.tasks.byId('quiet-header-drop').date===headerDates[3]&&plugin.tasks.byId('quiet-header-drop').start==='','quiet week header still schedules a dropped task as all-day');
for(const page of ['today','tasks']){view.show(page,D);await tick();view.openNew();await tick();let modal=O.openModals.at(-1);check(!modal.contentEl.contains(document.activeElement)||!document.activeElement.matches('input[type=text]'),'opening '+page+' does not focus the title');check([...modal.contentEl.querySelectorAll('.lubi-name-options')].every(x=>x.hidden),'opening '+page+' does not open history');if(page==='today'){[...modal.contentEl.querySelectorAll('.lubi-kind-seg button')].find(x=>x.textContent.includes('支出')).click();await tick();modal=O.openModals.at(-1);Record=modal.constructor;check(!document.activeElement.matches('input[type=text]'),'opening expense does not focus title')}if(page==='tasks'){const input=modal.contentEl.querySelector('[role=combobox]');input.focus();await tick();check(!modal.contentEl.querySelector('.lubi-name-options').hidden,'explicit input focus still opens history')}modal.close()}
const money=plugin.settings.categories.find(c=>c.kind==='money');const expense=new Record(app,plugin,{date:D,defaults:{category:money.name}});expense.open();await tick();check(!document.activeElement.matches('input[type=text]'),'initial expense opening does not focus title');expense.close();
for(const [key,page] of [['1','tasks'],['2','review']]){root.dispatchEvent(new window.KeyboardEvent('keydown',{key,bubbles:true}));await tick();check(view.tab===page,'shortcut '+key+' follows new tab order')}
const donutDate='2096-02-15';
for(const expenseOnly of [false,true]) {
  if(expenseOnly)await plugin.journal.add({date:donutDate,start:'12:00',minutes:0,category:money.name,title:'合成支出',amount:15,expenseType:'餐饮',extra:{}});
  const filesBefore=JSON.stringify([...app.vault.files]);view.show('today',donutDate);await tick();
  const card=root.querySelector('.lubi-distribution'),ring=card?.querySelector('.lubi-donut');
  check(!!ring&&ring.querySelector('.lubi-donut-center')?.textContent==='0h'&&ring.querySelector('.lubi-donut-sub')?.textContent==='覆盖 0%','empty '+(expenseOnly?'expense-only ':'')+'distribution keeps the ring with zero time and coverage');
  check(ring?.querySelectorAll('circle').length===1&&!ring.querySelector('circle[stroke-dasharray]')&&!card.querySelector('.lubi-legend-row')&&card.textContent.includes('暂无记录'),'empty distribution has only the neutral base ring without invented category slices');
  check(!/NaN|Infinity/.test(card.textContent)&&JSON.stringify([...app.vault.files])===filesBefore,'rendering the empty donut produces no invalid totals or record/task writes');
  if(expenseOnly)check(card.querySelector('.lubi-kv-val')?.textContent==='¥15.00 · 1 笔','expense-only distribution keeps real spending while its time ring stays empty');
}
const emptyReviewFiles=JSON.stringify([...app.vault.files]);
for(const [period,count] of [['week',7],['month',29],['year',12]]) {
  view.review.period=period;view.review.display='chart';view.show('review','2088-02-15');await tick();
  const review=root.querySelector('.lubi-review');
  check(!!review?.querySelector('.lubi-kpis')&&!!review.querySelector('.lubi-chart-card')&&!!review.querySelector('.lubi-review-extras'),'empty '+period+' review keeps metrics, chart and details');
  check(review.querySelector('.lubi-kpis')?.textContent.includes('0h')&&review.querySelector('.lubi-kpis')?.textContent.includes('¥0')&&review.querySelector('.lubi-review-empty-note')?.textContent==='本期暂无记录','empty '+period+' review shows zero values and a concise note');
  check(review.querySelectorAll('.lubi-bar-col').length===count&&review.querySelectorAll('.lubi-bar-col.is-empty').length===count,'empty '+period+' review keeps every date bucket with no data bars');
  check(['暂无分类记录','暂无事项记录','暂无支出记录'].every(label=>review.querySelector('.lubi-review-extras')?.textContent.includes(label)),'empty '+period+' review keeps all detail sections');
  check(!review.querySelector('.lubi-empty,.lubi-chart-avg,.lubi-kpi-delta')&&!/NaN|Infinity/.test(review.textContent)&&[...review.querySelectorAll('[style]')].every(el=>!/NaN|Infinity/.test(el.getAttribute('style'))),'empty '+period+' review has no collapsed placeholder, invented average, delta or invalid numeric values');
  if(period==='year')check(review.querySelectorAll('.lubi-heat-cell[data-date]').length===366&&review.querySelectorAll('.lubi-heat-cell[data-date].lv-0').length===366,'empty year review keeps all leap-year heatmap dates at zero coverage');
  [...review.querySelectorAll('.lubi-chart-mode button')].find(button=>button.textContent==='表格').click();await tick();
  const table=root.querySelector('.lubi-review-table-wrap');
  check(!table.hidden&&table.querySelectorAll('tbody tr').length===count&&[...table.querySelectorAll('tbody tr')].every(row=>[...row.querySelectorAll('td')].slice(0,2).every(cell=>cell.textContent==='0h')),'empty '+period+' review table keeps all dates and zero record/coverage values');
  [...root.querySelectorAll('.lubi-chart-mode button')].find(button=>button.textContent==='图表').click();await tick();
  check(!root.querySelector('.lubi-chart').hidden&&root.querySelector('.lubi-review-table-wrap').hidden,'empty '+period+' review switches back to the chart');
}
check(JSON.stringify([...app.vault.files])===emptyReviewFiles,'opening empty review views and toggling the table never writes records or tasks');
view.review.period='week';view.review.display='chart';
view.show('review',D);await tick();const body=root.querySelector('.lubi-body'),empty=body.empty.bind(body);body.empty=()=>{empty();body.scrollTop=0};
body.scrollTop=92;[...root.querySelectorAll('.lubi-review .lubi-seg-item')].find(x=>x.textContent==='年').click();await tick();check(body.scrollTop===92,'first switch to year preserves body scroll despite DOM replacement');
body.scrollTop=51;[...root.querySelectorAll('.lubi-review .lubi-seg-item')].find(x=>x.textContent==='周').click();await tick();check(body.scrollTop===51,'period switch keeps current viewport instead of stale cached scroll');
const readRange=plugin.journal.readRange.bind(plugin.journal);plugin.journal.readRange=async(...args)=>{const result=await readRange(...args);body.scrollTop=37;return result};
[...root.querySelectorAll('.lubi-review .lubi-seg-item')].find(x=>x.textContent==='年').click();await tick();check(body.scrollTop===37,'period rendering retains a scroll made while records load');plugin.journal.readRange=readRange;
await plugin.tasks.upsert(blankTask({id:'cue-plan',title:'计划标题不应被盖住',category:'学习',date:D,start:'09:00',estimate:60}));await plugin.journal.add({date:D,start:'08:00',minutes:60,category:'学习',title:'记录标题不应被盖住',extra:{}});
// Allow fixture-triggered debounced refresh to finish before checking focused tooltips.
await new Promise(resolve=>setTimeout(resolve,220));
view.show('today',D);await tick();
const planMeta=root.querySelector('.lubi-plan-task-list .lubi-task-meta-time');
check(planMeta?.textContent==='09:00'&&planMeta.parentElement.textContent.includes('09:00 · 1h'),'daily plan preserves metadata text and separates time styling');
const progress=root.querySelector('.lubi-plan-progress');
check(progress?.getAttribute('aria-valuetext')===`${progress.getAttribute('aria-valuenow')}/${progress.getAttribute('aria-valuemax')} 已完成`,'daily progress exposes the unchanged completion count');
const shortHint=root.querySelector('.lubi-task-start');shortHint.focus();await tick();check(document.querySelector('.lubi-tip')?.classList.contains('is-label'),'short button hint uses compact presentation');shortHint.blur();
root.querySelector('.lubi-block').focus();await tick();check(!!document.querySelector('.lubi-task-tip-title')&&!document.querySelector('.lubi-tip').classList.contains('is-label'),'task detail card keeps its richer presentation');root.querySelector('.lubi-block').blur();
const before=JSON.stringify([...app.vault.files]);
const pointer=(target,type,y)=>{const e=new window.MouseEvent(type,{bubbles:true,cancelable:true,clientX:200,clientY:y,button:0});Object.defineProperty(e,'pointerId',{value:99});target.dispatchEvent(e)};
for(const selector of ['.lubi-block','.lubi-plan'])for(const mode of ['move','resize-start','resize-end']){const el=root.querySelector(selector);const handle=mode==='move'?el:el.querySelector(mode==='resize-start'?'.is-top':'.is-bottom');pointer(handle,'pointerdown',100);pointer(window,'pointermove',156);const readout=root.querySelector('.lubi-drag-readout');check(!!readout&&!readout.hidden&&readout.textContent.includes('–')&&!readout.textContent.includes('\n')&&!root.querySelector('.lubi-timeline-scroll').contains(readout),selector+' '+mode+' has a separate, visible time readout');check(readout?.dataset.anchor==='axis'&&!!readout.style.top&&!!readout.style.left,selector+' '+mode+' readout is anchored beside the left time axis');check(root.querySelector('.lubi-tl-hover-label').hidden,selector+' '+mode+' hides the overlapping inline time label');const guide=root.querySelector('.lubi-tl-hover');check(guide.classList.contains('is-drag-guide'),selector+' '+mode+' extends the drag guide to the time axis');check(Math.abs(parseFloat(guide.style.top)-(parseFloat(el.style.top)+(selector==='.lubi-plan'?-32:0)+(mode==='resize-end'?parseFloat(el.style.height)+2:0)))<.01,selector+' '+mode+' uses the active start/end boundary');const segment=document.createElement('span');segment.className='lubi-drag-guide-segment';el.appendChild(segment);el.classList.add('lubi-drag-guide-host');window.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await tick();check(!readout||readout.hidden,selector+' '+mode+' clears feedback on cancel');check(!guide.classList.contains('is-drag-guide')&&!root.querySelector('.lubi-drag-obscured,.lubi-drag-guide-segment,.lubi-drag-guide-host'),selector+' '+mode+' restores ruler labels and clears in-card guides on cancel')}
check(JSON.stringify([...app.vault.files])===before,'cancelled cue gestures do not write tasks or actual records');
// Freeze persistence to expose stale hover metadata while the gesture finishes.
for(const selector of ['.lubi-block','.lubi-plan']) {
  view.show('today',D);await tick();const el=root.querySelector(selector);const oldRange=el.querySelector(selector==='.lubi-block'?'.lubi-block-time':'.lubi-plan-time').textContent;
  let release;const gate=new Promise(r=>release=r);const owner=selector==='.lubi-block'?plugin.journal:plugin.tasks;const key=selector==='.lubi-block'?'update':'upsert';const save=owner[key].bind(owner);owner[key]=async(...args)=>{await gate;return save(...args)};
  pointer(el,'pointerdown',100);pointer(window,'pointermove',156);const preview=root.querySelector('.lubi-drag-readout').firstChild.textContent;pointer(window,'pointerup',168);
  check(el.querySelector(selector==='.lubi-block'?'.lubi-block-time':'.lubi-plan-time').textContent!==preview,selector+' release applies the final pointer position before persistence completes');
  check(root.querySelector('.lubi-tl-hover-label').hidden,selector+' release does not uncover the old inline label during hover fade-out');
  el.dispatchEvent(new window.MouseEvent('pointerout',{bubbles:true,relatedTarget:document.body}));
  const tipMove=new window.MouseEvent('pointermove',{bubbles:true,clientX:200,clientY:156,buttons:0});el.dispatchEvent(tipMove);await new Promise(r=>setTimeout(r,300));
  check(root.querySelector('.lubi-drag-readout').hidden,selector+' release hides drag readout immediately');
  check(!document.querySelector('.lubi-tip')?.textContent.includes(oldRange),selector+' release never flashes stale old-time hover while save is pending');
  release();owner[key]=save;await new Promise(r=>setTimeout(r,180));
  const current=root.querySelector(selector);current.focus();await tick();check(!!document.querySelector('.lubi-tip'),'updated task keeps ordinary keyboard hover after save');current.blur();
}
plugin.onunload();await view.onClose();view.containerEl.remove();if(failures)process.exitCode=1;
