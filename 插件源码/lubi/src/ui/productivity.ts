import { Modal, Notice, TFile } from 'obsidian';
import type LubiPlugin from '../main';
import { backlog, effort, parseRestore, restoreWarnings, safeLink, TaskOutcome, timerElapsed, timerRecords, validBudget, validateOutcome } from '../core/productivity';
import { backgroundRuntimeMs } from '../core/execution';
import { fmtDuration, shiftDate, todayStr, weekStart } from '../core/time';
import { ConfirmModal } from './modals';
export type ProductTab = 'cost' | 'review' | 'backlog' | 'timer' | 'restore';

export class ProductivityModal extends Modal {
  private tab: ProductTab;
  private body!: HTMLElement;
  private generation = 0;
  private interval?: number;
  private working = false;
  constructor(private plugin: LubiPlugin, tab: ProductTab = 'cost') { super(plugin.app); this.tab = tab; }
  onOpen(): void {
    this.modalEl.addClass('lubi-product-modal','lubi-modal');
    this.contentEl.createEl('style', { text: `.lubi-product-modal{width:min(880px,95vw)}.lubi-product-modal .product-nav{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px}.lubi-product-modal .product-nav button[aria-pressed=true]{background:var(--interactive-accent);color:var(--text-on-accent)}.lubi-product-modal label{display:block;margin:12px 0 5px}.lubi-product-modal input:not([type=checkbox]),.lubi-product-modal select,.lubi-product-modal textarea{width:100%;max-width:100%;box-sizing:border-box}.lubi-product-modal textarea{min-height:90px}.lubi-product-modal button{margin:5px 8px 5px 0;white-space:normal;height:auto;min-height:32px}.lubi-product-modal .product-box{padding:12px;border:1px solid var(--background-modifier-border);border-radius:8px;margin:12px 0}.lubi-product-modal .product-list{max-height:300px;overflow:auto;border:1px solid var(--background-modifier-border);border-radius:8px;margin:8px 0 12px}.lubi-product-modal .product-list label{display:flex;align-items:center;gap:8px;margin:0;padding:7px 10px;border-top:1px solid var(--background-modifier-border);font-size:var(--font-ui-small)}.lubi-product-modal .product-list label:first-child{border-top:0}.lubi-product-modal .product-list label:hover{background:var(--background-secondary)}.lubi-product-modal p{font-size:var(--font-ui-small);color:var(--text-muted);line-height:1.6;margin:8px 0}.lubi-product-modal p,.lubi-product-modal pre{overflow-wrap:anywhere;white-space:pre-wrap}.lubi-product-modal .modal-content{max-height:80vh;overflow:auto}.lubi-product-modal .product-status{color:var(--text-muted)}@media(max-width:500px){.lubi-product-modal .product-nav button{flex:1 1 42%}}` });
    this.contentEl.createEl('h2', { text: 'Lubi · 工作复盘与整理' });
    const nav = this.contentEl.createDiv('product-nav');
    const tabs: [ProductTab,string][] = [['cost','投入与成果'],['review','周复盘'],['backlog','待整理'],['timer','实时计时'],['restore','数据恢复']];
    for (const [id,text] of tabs) { const b=nav.createEl('button',{text}); b.setAttribute('aria-pressed',String(this.tab===id)); b.onclick=()=>{ if(this.working)return; this.tab=id; for(const el of Array.from(nav.querySelectorAll('button')))el.setAttribute('aria-pressed',String(el===b)); void this.render(); }; }
    this.body=this.contentEl.createDiv(); void this.render();
  }
  onClose(): void { this.generation++; if(this.interval!==undefined) window.clearInterval(this.interval); this.contentEl.empty(); }
  private text(parent: HTMLElement, text: string): HTMLElement { return parent.createEl('p',{text}); }
  private input(parent: HTMLElement,label: string,value='',type='text'): HTMLInputElement { const l=parent.createEl('label',{text:label}); const e=l.createEl('input',{type,value}); e.setAttribute('aria-label',label); return e; }
  private area(parent: HTMLElement,label: string,value=''): HTMLTextAreaElement { const l=parent.createEl('label',{text:label}); const e=l.createEl('textarea'); e.value=value; e.setAttribute('aria-label',label); return e; }
  private select(parent: HTMLElement,label: string,options: [string,string][]): HTMLSelectElement { const l=parent.createEl('label',{text:label}),s=l.createEl('select'); s.setAttribute('aria-label',label); for(const [value,text] of options)s.createEl('option',{value,text}); return s; }
  private check(parent: HTMLElement,label: string,checked=false): HTMLInputElement { const l=parent.createEl('label'),e=l.createEl('input',{type:'checkbox'}); e.checked=checked; l.append(document.createTextNode(' '+label)); return e; }
  private button(parent: HTMLElement,label: string,run:()=>Promise<void>|void): HTMLButtonElement { const b=parent.createEl('button',{text:label}); b.onclick=()=>void this.act(run); return b; }
  private async act(run:()=>Promise<void>|void):Promise<void> { if(this.working)return;this.working=true;this.body.setAttribute('aria-busy','true');try{await run();}catch(e){new Notice((e as Error).message,9000);}finally{this.working=false;this.body.setAttribute('aria-busy','false');} }
  private async render():Promise<void> {
    const token=++this.generation; if(this.interval!==undefined)window.clearInterval(this.interval); this.interval=undefined;this.body.empty();this.body.onchange=null;
    try { await this.plugin.tasks.load(); if(token!==this.generation)return;
      if(this.tab==='cost')await this.cost(token); else if(this.tab==='review')await this.review(token); else if(this.tab==='backlog')this.backlog(); else if(this.tab==='timer')this.timer(); else this.restore();
    }catch(e){if(token===this.generation){this.text(this.body,'读取失败：'+(e as Error).message);if(this.tab==='timer')this.button(this.body,'清除异常计时会话',()=>new ConfirmModal(this.app,'清除异常计时','只清除计时状态，不删除已保存记录。',()=>void this.act(async()=>{await this.plugin.product.discardTimer();await this.render();}),'清除',false).open());}}
  }
  private async cost(token:number):Promise<void> {
    this.text(this.body,'累计本人投入与后台标注分开。预算是整个任务／项目的总预算，不累加单条记录的预计快照。');
    const records=await this.plugin.product.records();if(token!==this.generation)return;
    const snapshot=await this.plugin.tasks.exportSnapshot();if(token!==this.generation)return;
    const tasks=snapshot.tasks.filter(t=>!(snapshot.projectContainers||[]).includes(t.id)).map(t=>this.plugin.tasks.byId(t.id)||t), projects=this.plugin.tasks.projectList;
    const choice=this.select(this.body,'查看对象',[...projects.map(p=>['p:'+p.id,'项目 · '+p.title] as [string,string]),...tasks.map(t=>['t:'+t.id,'任务 · '+t.title+(t.archived?'（已归档）':'')] as [string,string])]);
    const box=this.body.createDiv();
    const show=()=>{
      box.empty(); const project=projects.find(p=>'p:'+p.id===choice.value),task=tasks.find(t=>'t:'+t.id===choice.value);
      if(!project&&!task){this.text(box,'暂无任务或项目，请先在计划页创建。');return;}
      const members=task?[task]:tasks.filter(t=>t.project===project!.id), total=effort(records,new Set(members.map(t=>t.id)));
      const budget=task?.budgetMinutes??project?.budgetMinutes??0;
      const summary=box.createDiv('product-box');this.text(summary,`本人累计 ${fmtDuration(total.actual)} · 待确认 ${fmtDuration(total.pending)} · 未完成任务 ${members.filter(t=>t.status!=='done'&&!t.archived).length}`);
      this.text(summary,budget?`总预算 ${fmtDuration(budget)} · ${total.actual>budget?'超出':'剩余'} ${fmtDuration(Math.abs(budget-total.actual))}`:'尚未设置总预算');
      const bg=members.reduce((n,t)=>n+Object.values(t.backgroundRuns||{}).reduce((s,r)=>s+backgroundRuntimeMs(r),0),0);
      this.text(summary,`后台墙钟标注 ${fmtDuration(bg/60000)}（非本人投入；并行运行相加）`);
      const b=this.input(box,'总预算（分钟；0 表示未设置）',String(budget),'number');b.min='0';
      this.button(box,'保存预算',async()=>{const n=validBudget(Number(b.value));if(task)await this.plugin.tasks.productBatch([{before:task,after:{...task,budgetMinutes:n}}]);else await this.plugin.tasks.setProjectBudget(project!.id,n);await this.render();});
      const details=box.createEl('details');details.createEl('summary',{text:`关联记录（${total.rows.length} 条）`});const list=details.createDiv('product-list');for(const r of total.rows.slice().sort((a,b)=>b.date.localeCompare(a.date)))this.text(list,`${r.date} ${r.start} · ${r.title} · ${fmtDuration(r.minutes)}${r.extra['待确认']?' · 待核对':''}`);
      if(!task)return;
      if(task.archived)this.button(box,'取消归档',async()=>{await this.plugin.tasks.productBatch([{before:task,after:{...task,archived:false}}]);await this.render();});
      const current:TaskOutcome=task.outcome||{links:[],criteria:[],history:[]};
      box.createEl('h3',{text:'成果与验收'});
      const links=this.area(box,'关联笔记／成果（每行 [[笔记#区块]] 或 https 链接）',current.links.join('\n'));
      for(const link of current.links){if(!safeLink(link))continue;this.button(box,`打开 ${link}`,async()=>{if(link.startsWith('[['))await this.plugin.app.workspace.openLinkText(link.slice(2,-2),'',true);else window.open(link,'_blank','noopener,noreferrer');});}
      const criteria=this.area(box,'验收清单（每行 - [ ] 条件；完成后改为 - [x]）',current.criteria.map(c=>`- [${c.done?'x':' '}] ${c.text}`).join('\n'));
      const outcome=this.select(box,'本次交付记录',[['','仅保存清单'],['submitted','提交成果'],['accepted','记录验收通过'],['rework','记录返工']]);
      const link=this.input(box,'本次成果链接（可选）');const reason=this.area(box,'意见／返工原因');
      this.text(box,'这里记录验收证据，不自动改变任务完成状态或生成本人用时；重复任务请在意见中写明发生日期。');
      this.button(box,'保存成果与验收',async()=>{
        const parsed=criteria.value.split('\n').filter(x=>x.trim()).map(x=>({done:/^\s*-?\s*\[[xX]\]/.test(x),text:x.replace(/^\s*-?\s*\[[ xX]\]\s*/,'').trim()}));
        if(outcome.value==='accepted'&&(!parsed.length||parsed.some(c=>!c.done)))throw new Error('验收通过前请填写并勾选全部条件');
        const next:TaskOutcome={links:links.value.split('\n').map(x=>x.trim()).filter(Boolean),criteria:parsed,history:[...current.history]};
        if(outcome.value)next.history.push({at:new Date().toISOString(),link:link.value.trim(),outcome:outcome.value as 'submitted'|'accepted'|'rework',reason:reason.value.trim()});
        validateOutcome(next);await this.plugin.tasks.productBatch([{before:task,after:{...task,outcome:next}}]);await this.render();
      });
      const history=box.createDiv('product-list');for(const h of current.history.slice().reverse())this.text(history,`${h.at} · ${{submitted:'交付',accepted:'验收通过',rework:'返工'}[h.outcome]} · ${h.link} ${h.reason}`);
    };choice.onchange=show;show();
  }
  private async review(token:number):Promise<void> {
    const date=this.input(this.body,'选择本周任一天',todayStr(),'date'),container=this.body.createDiv();
    let loadRevision=0;
    const load=async()=>{
      const revision=++loadRevision;
      const week=weekStart(date.value||todayStr()),path=`Lubi-复盘/${week}.md`;container.empty();
      const f=this.plugin.app.vault.getAbstractFileByPath(path),expected=f instanceof TFile?await this.plugin.app.vault.read(f):null;
      const previous=this.plugin.app.vault.getAbstractFileByPath(`Lubi-复盘/${shiftDate(week,-7)}.md`);
      if(token!==this.generation||revision!==loadRevision)return;
      this.text(container,`复盘范围：${week} — ${shiftDate(week,6)}。先检查待确认记录，再决定下周调整。`);
      if(previous instanceof TFile)this.button(container,'回看上周承诺',()=>void this.plugin.app.workspace.getLeaf('tab').openFile(previous));
      if(expected){const d=container.createEl('details');d.createEl('summary',{text:'查看现有周报（保存会替换，先核对）'});d.createEl('pre',{text:expected});}
      const found=expected?.split('## 本周发现\n')[1]?.split('\n## 下周行动')[0]?.trim()||'';
      const oldActions=expected?.split('## 下周行动\n')[1]?.split('\n\n')[0]?.replace(/^- \[[ xX]\] /gm,'')||'';
      const finding=this.area(container,'本周发现：保留什么、减少什么？',found),actions=this.area(container,'下周行动（每行一项，不会自动排期）',oldActions);
      const category=this.select(container,'行动分类',this.plugin.settings.categories.filter(c=>c.kind==='time').map(c=>[c.name,c.name]));
      const create=this.check(container,'同时创建这些未安排任务（相同周＋相同原文不重复）');
      this.button(container,'保存周报',async()=>{const p=await this.plugin.product.saveReview(week,finding.value,actions.value.split('\n'),category.value,create.checked,expected);new Notice('已保存：'+p);await load();});
    };date.onchange=()=>void this.act(load);await load();
  }
  private backlog():void {
    this.text(this.body,'整理逾期或未安排的一次性任务。重复任务逐次处理，请用原计划页；不会自动滚到今天。改期会清除具体开始时间，保留已有跨度长度。');
    const rows=backlog(this.plugin.tasks.all,todayStr()),chosen=new Set<string>();
    const all=this.check(this.body,`全选 ${rows.length} 项`),checks:HTMLInputElement[]=[];
    const list=this.body.createDiv('product-list');
    for(const t of rows){const c=this.check(list,`${t.title} · ${t.date||'未安排'}${t.estimate?' · '+fmtDuration(t.estimate):''}${t.reschedules?' · 已改期 '+t.reschedules+' 次':''}`);c.onchange=()=>{if(c.checked)chosen.add(t.id);else chosen.delete(t.id);};checks.push(c);}
    all.onchange=()=>{chosen.clear();checks.forEach((c,i)=>{c.checked=all.checked;if(c.checked)chosen.add(rows[i].id);});};
    const date=this.input(this.body,'安排到',todayStr(),'date'),load=this.body.createEl('p');
    const update=()=>{const selected=rows.filter(t=>chosen.has(t.id));const scheduled=this.plugin.tasks.all.filter(t=>t.date===date.value&&!chosen.has(t.id)&&t.status!=='done');const minutes=[...scheduled,...selected].reduce((n,t)=>n+Math.max(0,t.estimate||0),0);load.textContent=`目标日已排＋所选预计：${fmtDuration(minutes)} / 可用 ${this.plugin.settings.dailyCapacityHours}h（未填预计及重复发生项未纳入此预览）`;};date.onchange=update;this.body.onchange=update;update();
    const selected=()=>rows.filter(t=>chosen.has(t.id));
    this.button(this.body,'批量改期',async()=>{await this.plugin.product.arrange(selected(),'date',date.value);await this.render();});
    this.button(this.body,'顺延到今日',async()=>{const tasks=selected();if(!tasks.length)throw new Error('请先选择任务');await this.plugin.product.arrange(tasks,'date',todayStr());await this.render();}).addClass('mod-cta');
    this.button(this.body,'放回未安排',async()=>{await this.plugin.product.arrange(selected(),'unschedule');await this.render();});
    this.button(this.body,'归档所选',()=>{const tasks=selected();if(!tasks.length)throw new Error('请先选择任务');new ConfirmModal(this.app,'归档任务',`归档 ${tasks.length} 项，历史记录保留。可在本会话撤销；不会标为完成。`,()=>void this.act(async()=>{await this.plugin.product.arrange(tasks,'archive');await this.render();}),'归档',false).open();});
    this.button(this.body,'撤销最近一次整理',async()=>{await this.plugin.product.undoArrange();await this.render();});
    const titles=this.area(this.body,'拆分为更小的行动（先只选一个原任务，每行一个新行动）');
    this.button(this.body,'拆分并归档原任务',()=>{const tasks=selected();if(tasks.length!==1)throw new Error('拆分时只能选择一项');new ConfirmModal(this.app,'拆分任务','原任务归档，实际记录仍关联原任务；新行动未安排且不继承预计。本操作不支持快捷撤销。',()=>void this.act(async()=>{await this.plugin.product.split(tasks[0],titles.value.split('\n'));await this.render();}),'确认拆分',false).open();});
  }
  private timer():void {
    this.text(this.body,'只记录本人投入；支持暂停、重启续接和跨午夜拆分。离开插件不会自动暂停；结束前必须核对。不会自动完成任务。');
    const s=this.plugin.settings.focusTimer;
    if(!s){const tasks=this.plugin.tasks.all.filter(t=>t.status!=='done');const choice=this.select(this.body,'关联任务',tasks.map(t=>[t.id,t.title]));this.button(this.body,'开始计时',async()=>{const task=this.plugin.tasks.byId(choice.value);if(!task)throw new Error('请先创建或选择任务');await this.plugin.product.startTimer(task);await this.render();});return;}
    this.text(this.body,s.title);const clock=this.body.createEl('h3');const tick=()=>{const ms=timerElapsed(s);clock.textContent=`${fmtDuration(ms/60000)} · ${s.runningSince===undefined?'已暂停':'计时中'}${ms>8*3600000?' · 时间过长，请核对':''}`;};tick();this.interval=window.setInterval(tick,1000);
    this.button(this.body,s.runningSince===undefined?'继续':'暂停并预览',async()=>{await this.plugin.product.toggleTimer();await this.render();});
    if(s.runningSince===undefined){const rows=timerRecords(s);this.text(this.body,'预览：暂停空隙不计入，每段不足一分钟的尾数舍去。');for(const r of rows)this.text(this.body,`${r.date} ${r.start} · ${fmtDuration(r.minutes)}`);const confirm=this.check(this.body,'我已核对以上各段为真实本人投入');this.button(this.body,'确认保存实际记录',async()=>{if(!confirm.checked)throw new Error('请先核对并勾选确认');await this.plugin.product.commitTimer(s.id);new Notice('已保存实际用时，任务状态未改变');await this.render();});}
    this.button(this.body,'放弃计时',()=>new ConfirmModal(this.app,'放弃计时','清除计时会话，不删除已成功保存的记录；未保存时间将丢失。',()=>void this.act(async()=>{await this.plugin.product.discardTimer();await this.render();}),'放弃',false).open());
  }
  private restore():void {
    this.text(this.body,'只恢复到新的隔离目录，绝不覆盖当前任务、日记或设置。完整导出不包含原日记其他章节或插件设置，因此不是整库备份。');
    this.button(this.body,'先导出当前数据',()=>this.plugin.exportJson());
    const file=this.input(this.body,'选择完整导出 JSON','','file');file.accept='.json,application/json';
    const status=this.body.createDiv('product-box');let text='';
    file.onchange=()=>void this.act(async()=>{text='';status.empty();const f=file.files?.[0];if(!f)return;if(f.size>25*1024*1024)throw new Error('文件超过 25MB');const raw=await f.text(),d=parseRestore(raw);text=raw;this.text(status,`${d.taskStore.tasks.length} 个任务 · ${d.taskStore.projects?.length||0} 个项目 · ${d.records.length} 条记录`);for(const warning of restoreWarnings(d))this.text(status,warning);this.text(status,'目标为全新隔离目录，无覆盖冲突；重复恢复会创建另一份副本，不会合并或自动去重。');});
    const confirm=this.check(this.body,'已核对预览，确认创建隔离恢复副本');
    this.button(this.body,'开始隔离恢复',async()=>{if(!text||!confirm.checked)throw new Error('请选择有效文件并确认预览');const root=await this.plugin.product.restore(text);text='';file.value='';confirm.checked=false;this.text(status,'恢复完成：'+root+'；请查看恢复说明.md');new Notice('隔离恢复完成，当前数据未改变',8000);});
  }
}
