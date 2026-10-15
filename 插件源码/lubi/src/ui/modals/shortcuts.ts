import { Modal } from "obsidian";

// ---------------- 快捷键速查 ----------------

export const SHORTCUTS: [string, string][] = [
  ["N", "新建任务 / 支出；实际用时在任务内填写"],
  ["1 / 2", "切换 计划 · 回顾"],
  ["T", "回到今天（计划页）"],
  ["← / →", "前一天 / 后一天（计划页）"],
  ["?", "打开本速查卡"],
  ["↑ / ↓", "时间轴：选中块移动 5 分钟（Alt 为 1 分钟）"],
  ["Shift + ↑ / ↓", "时间轴：改时长"],
  ["Enter / Delete", "时间轴：编辑 / 删除选中块"],
  ["Alt + 1…9", "新建记录：切换分类"],
  ["Enter", "新建 / 编辑：保存"],
  ["Esc", "取消拖动 / 关闭窗口"],
];

export class ShortcutsModal extends Modal {
  onOpen(): void {
    this.modalEl.addClass("lubi-modal", "lubi-modal-sm", "lubi-shortcuts-modal");
    this.titleEl.setText("快捷键");
    const list = this.contentEl.createDiv({ cls: "lubi-shortcuts" });
    for (const [k, d] of SHORTCUTS) {
      const row = list.createDiv({ cls: "lubi-shortcut-row" });
      const keys = row.createSpan({ cls: "lubi-shortcut-keys" });
      k.split(" ").forEach((part) => {
        if (part === "/" || part === "+" || part === "…") keys.createSpan({ cls: "lubi-muted", text: ` ${part} ` });
        else keys.createEl("kbd", { text: part });
      });
      row.createSpan({ cls: "lubi-shortcut-desc", text: d });
    }
  }
}
