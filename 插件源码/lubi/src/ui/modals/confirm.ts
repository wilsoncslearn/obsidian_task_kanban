import { App, Modal } from "obsidian";
import { button } from "../components";

// ---------------- 通用确认 ----------------

export class ConfirmModal extends Modal {
  constructor(app: App, private title: string, private body: string, private onOk: () => void, private okLabel = "确定", private danger = true) {
    super(app);
  }
  onOpen(): void {
    this.modalEl.addClass("lubi-modal", "lubi-modal-sm");
    this.titleEl.setText(this.title);
    this.contentEl.createEl("p", { text: this.body, cls: "lubi-confirm-body" });
    const row = this.contentEl.createDiv({ cls: "lubi-modal-actions" });
    button(row, "取消", () => this.close(), { cls: "lubi-btn-ghost" });
    const ok = button(row, this.okLabel, () => {
      this.close();
      this.onOk();
    }, { primary: !this.danger });
    if (this.danger) ok.addClass("lubi-btn-danger");
  }
}
