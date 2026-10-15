import { Notice } from "obsidian";
import type LubiPlugin from "../../main";
import { Rec } from "../../core/records";
import { categoryOf } from "../../settings";
import { RecordModal } from "./record";
import { TaskModal } from "./task";

/** Public time-entry routes share the task form; the record editor remains for existing timeline records. */
export function openUnifiedRecord(plugin: LubiPlugin, date: string, defaults: Partial<Rec> = {}, onSaved?: (rec?: Rec) => void | Promise<void>, completionDate?: string): void {
  if ((defaults.category && categoryOf(plugin.settings, defaults.category).kind === 'money') || defaults.amount !== undefined) {
    new RecordModal(plugin.app, plugin, { date, defaults, onSaved }).open(); return;
  }
  const task = defaults.task ? plugin.tasks.byId(defaults.task) : undefined;
  if (defaults.task && !task) { new Notice("任务已不存在，请刷新后再记录"); return; }
  new TaskModal(plugin.app, plugin, {
    task, defaults: task ? undefined : { title: defaults.title || '', category: defaults.category || '', notes: defaults.notes || '', date },
    recordDate: date, completionDate: completionDate || (task ? date : undefined), actualRequired: true, quickActual: true,
    actualDefaults: task ? undefined : { minutes: defaults.minutes, start: defaults.start },
    onActualSaved: async rec => { await onSaved?.(rec); },
  }).open();
}
