import { App, Modal } from "obsidian";
import type LubiPlugin from "../../main";
import { Task } from "../../core/tasks";
import { button, undoNotice } from "../components";

// ---------------- 删除任务（含关联记录的处理） ----------------

export class DeleteTaskModal extends Modal {
  private removeRecords = false;

  constructor(app: App, private plugin: LubiPlugin, private task: Task, private onDone: () => void) {
    super(app);
  }

  async onOpen(): Promise<void> {
    this.modalEl.addClass("lubi-modal", "lubi-modal-sm");
    this.titleEl.setText("删除任务？");
    const all = [this.task, ...this.plugin.tasks.descendants(this.task.id)];
    const ids = new Set(all.map((t) => t.id));
    const kids = all.length - 1;
    this.contentEl.createEl("p", { cls: "lubi-confirm-body", text: kids ? `「${this.task.title}」会连同 ${kids} 个子任务一起删除。` : `「${this.task.title}」` });
    const linked = await this.plugin.journal.linkedTo(ids);
    if (linked.length) {
      const box = this.contentEl.createDiv({ cls: "lubi-delete-opts", attr: { role: "radiogroup", "aria-label": "关联记录的处理方式" } });
      box.createDiv({ cls: "lubi-muted", text: `时间线上有 ${linked.length} 条记录关联了${kids ? "这些任务" : "这个任务"}：` });
      const opt = (value: boolean, label: string, desc: string) => {
        const row = box.createEl("label", { cls: "lubi-delete-opt" });
        const input = row.createEl("input", { type: "radio", attr: { name: "lubi-delete-records" } });
        input.checked = value === this.removeRecords;
        input.addEventListener("change", () => { if (input.checked) this.removeRecords = value; });
        const text = row.createDiv();
        text.createDiv({ text: label });
        text.createDiv({ cls: "lubi-muted", text: desc });
      };
      opt(false, "保留记录，只解除关联", "时间确实花掉了，回顾统计不变");
      opt(true, `连同这 ${linked.length} 条记录一起删除`, "适合建错的任务或误记的时间");
    }
    const row = this.contentEl.createDiv({ cls: "lubi-modal-actions" });
    button(row, "取消", () => this.close(), { cls: "lubi-btn-ghost" });
    const ok = button(row, "删除", () => void this.run(all, ids, linked.length > 0));
    ok.addClass("lubi-btn-danger");
  }

  private async run(all: Task[], ids: Set<string>, hasLinked: boolean): Promise<void> {
    this.close();
    const snapshot: Task[] = JSON.parse(JSON.stringify(all));
    const removed = this.removeRecords;
    const touched = hasLinked ? await this.plugin.journal.detachTasks(ids, removed) : [];
    await this.plugin.tasks.remove(this.task.id);
    this.onDone();
    const what = !touched.length ? "" : removed ? `，并删除 ${touched.length} 条记录` : `，${touched.length} 条记录已解除关联`;
    undoNotice(`已删除「${this.task.title}」${what}`, async () => {
      for (const t of snapshot) if (!this.plugin.tasks.byId(t.id)) await this.plugin.tasks.upsert(t);
      if (touched.length) await this.plugin.journal.restoreDetached(touched, removed);
      this.onDone();
    });
  }
}
