/** Reuse existing controls/listeners; collapsing optional settings never clears saved data. */
import type LubiPlugin from '../main';
import type { Task } from '../core/tasks';
import { fmtDuration } from '../core/time';
import { executorOf } from '../core/execution';

interface LightForm {
  host: HTMLElement; task: Task; plugin: LubiPlugin; moreOpen: boolean;
  title: HTMLElement; categories: HTMLElement; grid: HTMLElement; start: HTMLElement;
  extras: HTMLElement; actions: HTMLElement; actual: HTMLElement[];
  onCategory: (category: string) => void; onRecord: () => void;
}
export function arrangeLightTaskForm(o: LightForm): void {
  const { host, task, plugin } = o;
  const field = (name: string) => o.extras.querySelector<HTMLElement>(`[data-extra-name="${name}"]`)!;
  const project = field('项目'), notes = field('备注');
  // These two fields are always present in the light form, not removable optional sections.
  for (const f of [project, notes]) { f.querySelector('.lubi-extra-head button')?.remove(); f.classList.remove('lubi-extra-field'); }
  for (const b of Array.from(o.extras.querySelectorAll<HTMLElement>('.lubi-extras-toggles button'))) if (['项目','备注'].includes(b.textContent?.trim() || '')) b.remove();
  o.categories.remove();
  for (const el of o.actual) el.remove();
  host.querySelectorAll('.lubi-task-divider').forEach(el => el.remove());
  const body = host.createDiv({ cls: 'lubi-light-body' });
  body.append(o.title);
  const meta = body.createDiv({ cls: 'lubi-light-meta' }); meta.append(project);
  const category = meta.createDiv({ cls: 'lubi-field' });
  const label = category.createEl('label', { text: '分类' });
  const select = label.createEl('select', { attr: { 'data-light-category': 'select', 'aria-label': '分类' } });
  for (const c of plugin.settings.categories.filter(c => c.kind === 'time')) select.createEl('option', { value: c.name, text: c.name });
  select.value = task.category;
  select.addEventListener('change', () => o.onCategory(select.value));
  o.grid.querySelector('.lubi-plan-full-field')?.classList.remove('lubi-plan-full-field');
  const dateLabel = o.grid.querySelector('label'); if (task.repeat.kind === 'none' && dateLabel) dateLabel.textContent = '计划日期';
  body.append(o.grid, notes);
  const recording = body.createDiv({ cls: 'lubi-light-recording' });
  const summary = recording.createSpan({ text: '读取已记录用时…', attr: { role: 'status' } });
  const record = recording.createEl('button', { cls: 'lubi-text-btn', text: '记用时', attr: { type: 'button', 'data-light-record': 'open' } });
  record.addEventListener('click', o.onRecord);
  // Display-only scan: never prefill the editor or block task saving on journal read failures.
  void plugin.journal.readRange(plugin.journal.dates()).then(map => {
    if (!summary.isConnected) return;
    const records = [...map.values()].flat().filter(r => r.task === task.id && r.minutes > 0 && r.amount === undefined);
    const confirmed = records.filter(r => !r.extra['待确认'] || r.extra['待确认'] === '实际开始未核对').reduce((sum,r) => sum+r.minutes,0);
    const pending = records.filter(r => r.extra['待确认'] && r.extra['待确认'] !== '实际开始未核对').reduce((sum,r) => sum+r.minutes,0);
    summary.textContent = `已记录 ${fmtDuration(confirmed)}${pending ? ` · 待确认 ${fmtDuration(pending)}` : ''}`;
  }).catch(() => { if (summary.isConnected) summary.textContent = '用时暂不可读取，不影响编辑任务'; });
  const more = body.createEl('details', { cls: 'lubi-light-more' }); more.open = o.moreOpen;
  const heading = more.createEl('summary');
  const update = () => {
    const recurrence = task.repeat.kind === 'none' ? '' : task.repeat.kind === 'daily' ? '每天' : task.repeat.kind === 'weekly' ? '每周 '+task.repeat.days.join('、') : '每月 '+task.repeat.days.join('、')+' 日';
    const status = { todo: '待办', doing: '进行中', done: '已完成' }[task.status];
    heading.textContent = ['更多设置', status, task.blocked ? '受阻' : '', recurrence, task.location, task.start, executorOf(task) === 'background' ? 'Agent 后台' : '', task.startDate || task.endDate ? `${task.startDate || '未定'} ～ ${task.endDate || '未定'}` : ''].filter(Boolean).join(' · ');
  };
  update();
  // Move every remaining setting into the disclosure, retaining native inputs and listeners.
  for (const node of Array.from(host.children)) if (node !== body && node !== o.actions) more.append(node);
  more.append(o.start);
  const del = o.actions.querySelector('.lubi-text-btn-danger'); if (del) more.append(del);
  host.append(body, o.actions);
  for (const event of ['input','change','click']) more.addEventListener(event, () => queueMicrotask(update), true);
}
