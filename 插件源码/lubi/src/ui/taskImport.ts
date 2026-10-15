import { App, Modal, Notice } from "obsidian";
import type LubiPlugin from "../main";
import { parseTaskImport, IMPORT_TASK_LIMIT } from "../core/taskImport";
import { button } from "./components";

export class JsonTaskImportModal extends Modal {
  private saving = false;
  constructor(app: App, private plugin: LubiPlugin, private onSaved?: () => void) { super(app); }
  onOpen(): void {
    this.modalEl.addClass("lubi-modal", "lubi-json-import-modal");
    this.titleEl.setText("JSON 任务导入");
    this.contentEl.createEl("p", { cls: "lubi-muted", text: `只新增任务，不覆盖现有数据；最多 ${IMPORT_TASK_LIMIT} 个。重复导入会新增重复任务。` });
    const label = this.contentEl.createEl("label", { cls: "lubi-field" });
    label.createSpan({ text: "粘贴 AI 生成的 JSON" });
    const input = label.createEl("textarea", { cls: "lubi-json-import-input", attr: { "aria-label": "JSON 任务数据", spellcheck: "false", placeholder: '{"tasks":[{"title":"复习章节","category":"学习","date":"","start":"","estimate":60,"location":""}]}' } });
    const error = this.contentEl.createDiv({ cls: "lubi-form-error", attr: { role: "alert" } });error.hidden = true;
    const actions = this.contentEl.createDiv({ cls: "lubi-modal-actions" });
    const cancel = button(actions, "取消", () => this.close(), { cls: "lubi-btn-ghost" });
    const submit = button(actions, "导入", () => void save(), { primary: true });
    const save = async () => {
      if (this.saving) return;
      error.hidden = true;error.setText("");
      try {
        const tasks = parseTaskImport(input.value, this.plugin.settings.categories.filter(c => c.kind === "time").map(c => c.name));
        this.saving = true;submit.disabled = true;cancel.disabled = true;
        await this.plugin.tasks.addBatch(tasks);
        this.close();new Notice(`已导入 ${tasks.length} 个任务`);this.onSaved?.();
      } catch (e) { error.setText(`导入失败：${(e as Error).message}`);error.hidden = false; }
      finally { this.saving = false;submit.disabled = false;cancel.disabled = false; }
    };
    input.addEventListener("keydown", e => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault();void save(); } });
  }
}
