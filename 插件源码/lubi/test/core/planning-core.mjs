import assert from 'node:assert/strict';
import {blankTask, planOccurrences, planInbox, planDatePatch, monthCalendarDays, ganttWindow, dailyGanttRows} from '../.out/core.mjs';
const task=(id, extra={})=>blankTask({id,title:id,created:'2026-01-01T00:00:00Z',order:1,...extra});
const tasks=[
  task('parent'), task('early',{date:'2026-10-06',start:'08:00',parent:'parent'}),
  task('late',{date:'2026-10-06',start:'14:00'}), task('all-day',{date:'2026-10-06'}),
  task('span',{startDate:'2026-10-04',endDate:'2026-10-09',date:'2026-10-07',start:'10:00',estimate:60}),
  task('span-no-date',{startDate:'2026-10-05',endDate:'2026-10-07'}),
  task('repeat',{repeat:{kind:'daily',days:[]},startDate:'2026-10-05',endDate:'2026-10-11',skipDates:['2026-10-08'],doneDates:['2026-10-06']}),
  task('inbox'),task('record',{date:'2026-10-06',origin:'record'}),task('outside',{date:'2026-11-01'})
];
const before=JSON.stringify(tasks);
const day=planOccurrences(tasks,['2026-10-06']);
assert.deepEqual(day.slice(0,2).map(x=>x.task.id),['early','late']);
assert(!day.some(x=>['parent','record','inbox','outside'].includes(x.task.id)));
assert(day.find(x=>x.task.id==='repeat').done);
assert(!day.find(x=>x.task.id==='span').timed,'a span does not repeat its scheduled clock time on every day');
const week=planOccurrences(tasks,ganttWindow('2026-10-06','week'));
assert.equal(week.filter(x=>x.task.id==='span').length,1);
assert.equal(week.find(x=>x.task.id==='span').date,'2026-10-07');
assert.equal(week.filter(x=>x.task.id==='repeat').length,6);
assert(!week.some(x=>x.task.id==='repeat'&&x.date==='2026-10-08'));
assert.deepEqual(planInbox(tasks).map(x=>x.id),['inbox']);
assert.deepEqual(planDatePatch(tasks.find(x=>x.id==='span'),'2026-10-09'),{startDate:'2026-10-06',endDate:'2026-10-11',date:'2026-10-09'});
assert.equal(planDatePatch(tasks.find(x=>x.id==='repeat'),'2026-10-09'),null);
assert.equal(planDatePatch(task('bad',{startDate:'2026-10-01'}),'2026-10-06'),null);
assert.equal(planDatePatch(task('single'),'2026-02-30'),null);
assert.deepEqual(planDatePatch(task('single',{start:'09:00'}),'2026-10-06'),{date:'2026-10-06'});
const grid=monthCalendarDays('2026-10-06');assert.equal(grid.length,35);assert.equal(grid[0],'2026-09-28');assert.equal(grid.at(-1),'2026-11-01');
assert.equal(monthCalendarDays('2026-02-06').length,35);
assert.equal(monthCalendarDays('2026-03-06').length,42);
assert.equal(monthCalendarDays('2027-02-06').length,28);
assert.deepEqual(dailyGanttRows(tasks,'2026-10-06').map(x=>x.task.id).sort(),day.map(x=>x.task.id).sort());
assert.equal(dailyGanttRows(tasks,'2026-10-06').find(x=>x.task.id==='span').start,null);
assert.equal(dailyGanttRows(tasks,'2026-10-07').find(x=>x.task.id==='span').start,600);
assert.equal(JSON.stringify(tasks),before,'all projections and proposed date patches are non-mutating');
console.log('PASS planning core: shared ranges, spans, repeat occurrences, sorting, calendar weeks, inbox, non-mutating moves');

const explicitParent=task('explicit-parent',{startDate:'2026-10-05',endDate:'2026-10-11'});
const futureChild=task('future-child',{parent:'explicit-parent',date:'2026-11-01'});
assert.deepEqual(planOccurrences([explicitParent,futureChild],ganttWindow('2026-10-06','week')).map(x=>x.task.id),['explicit-parent']);
assert.deepEqual(dailyGanttRows([explicitParent,futureChild],'2026-10-06').map(x=>x.task.id),['explicit-parent']);
assert.deepEqual(dailyGanttRows([explicitParent,futureChild],'2026-11-01').map(x=>x.task.id),['future-child'],'outside explicit parents are only headings, not allocations');
assert.deepEqual(planOccurrences([task('dated-parent',{date:'2026-10-06'}),task('child',{parent:'dated-parent',date:'2026-11-01'})],['2026-10-06']).map(x=>x.task.id),['dated-parent']);
assert.deepEqual(planDatePatch(explicitParent,'2026-10-06','2026-10-05'),{startDate:'2026-10-06',endDate:'2026-10-12'});
assert.deepEqual(planDatePatch(explicitParent,'2026-10-05','2026-10-05'),{});
assert.equal(planDatePatch(explicitParent,'2026-10-06','2026-11-01'),null);
console.log('PASS explicit parents and continuation-day drag anchoring');
