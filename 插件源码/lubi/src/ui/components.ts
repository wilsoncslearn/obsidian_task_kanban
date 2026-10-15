// 极小的 UI 组件集：全部走 CSS class，不写内联样式（动态几何除外）。

import { Notice, setIcon } from "obsidian";
import { CategoryDef } from "../settings";
import { setTipLabel } from "./tooltips";
export { hideTip, hoverTip, infoTip } from "./tooltips";

/** 每日页时间轴与任务页周日程共用的纵向刻度：同一时刻在两页的高度一致 */
export const HOUR_PX = 56;

export function el<K extends keyof HTMLElementTagNameMap>(
  parent: HTMLElement,
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const n = parent.createEl(tag, { cls, text });
  return n;
}

export function icon(parent: HTMLElement, name: string, cls = "lubi-icon"): HTMLElement {
  const s = parent.createSpan({ cls });
  setIcon(s, name);
  return s;
}

/**
 * 统一使用 Lubi 浅色提示；读屏名称独立保留，避免原生双提示。
 */
export function tip<T extends HTMLElement>(el: T, text: string): T {
  setTipLabel(el, text);
  return el;
}

export function iconButton(parent: HTMLElement, name: string, label: string, onClick: () => void, cls = ""): HTMLButtonElement {
  const b = parent.createEl("button", { cls: `lubi-icon-btn ${cls}`.trim(), attr: { "aria-label": label, "data-lubi-focus": `icon:${label}` } });
  setIcon(b, name);
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

export function button(parent: HTMLElement, label: string, onClick: () => void, opts: { primary?: boolean; icon?: string; cls?: string } = {}): HTMLButtonElement {
  const b = parent.createEl("button", { cls: `lubi-btn ${opts.primary ? "mod-cta" : ""} ${opts.cls || ""}`.trim(), attr: { "data-lubi-focus": `button:${label}` } });
  if (opts.icon) icon(b, opts.icon, "lubi-icon lubi-btn-icon");
  b.createSpan({ text: label });
  b.addEventListener("click", (e) => {
    e.preventDefault();
    onClick();
  });
  return b;
}

export function segmented<T extends string>(
  parent: HTMLElement,
  items: { id: T; label: string; icon?: string }[],
  active: T,
  onChange: (id: T) => void,
): HTMLElement {
  const wrap = parent.createDiv({ cls: "lubi-seg" });
  for (const it of items) {
    const b = wrap.createEl("button", { cls: "lubi-seg-item", attr: { "aria-pressed": String(it.id === active), "data-lubi-focus": `seg:${it.id}` } });
    if (it.icon) icon(b, it.icon, "lubi-icon lubi-seg-icon");
    b.createSpan({ text: it.label });
    b.addEventListener("click", () => {
      // 以 DOM 上的 aria-pressed 为准：外部（如 openDate 跳转）可能已改过当前页
      if (b.getAttribute("aria-pressed") === "true") return;
      wrap.querySelectorAll(".lubi-seg-item").forEach((x) => x.setAttribute("aria-pressed", "false"));
      b.setAttribute("aria-pressed", "true");
      onChange(it.id);
    });
  }
  return wrap;
}

export function catDot(parent: HTMLElement, cat: CategoryDef, tone = "var(--color-ink)"): HTMLElement {
  const d = parent.createSpan({ cls: "lubi-dot" });
  d.style.setProperty("--dot", tone);
  return d;
}

export function catChip(parent: HTMLElement, cat: CategoryDef, text?: string): HTMLElement {
  const c = parent.createSpan({ cls: "lubi-chip" });
  c.style.setProperty("--chip", "var(--color-ink)");
  icon(c, cat.icon, "lubi-icon lubi-chip-icon");
  c.createSpan({ text: text ?? cat.name });
  return c;
}

export function emptyState(parent: HTMLElement, iconName: string, title: string, hint?: string, action?: { label: string; onClick: () => void }): HTMLElement {
  const box = parent.createDiv({ cls: "lubi-empty" });
  icon(box, iconName, "lubi-icon lubi-empty-icon");
  box.createDiv({ cls: "lubi-empty-title", text: title });
  if (hint) box.createDiv({ cls: "lubi-empty-hint", text: hint });
  if (action) button(box, action.label, action.onClick, { primary: true, icon: "plus" });
  return box;
}

/** 环形图（SVG） */
export function donut(parent: HTMLElement, slices: { value: number; color: string; label: string }[], centerText: string, centerSub?: string): SVGSVGElement {
  const size = 120;
  const r = 48;
  const stroke = 14;
  const svg = parent.createSvg("svg", { cls: "lubi-donut", attr: { viewBox: `0 0 ${size} ${size}`, width: String(size), height: String(size) } });
  const total = slices.reduce((s, x) => s + x.value, 0);
  const c = 2 * Math.PI * r;
  svg.createSvg("circle", { attr: { cx: size / 2, cy: size / 2, r, fill: "none", stroke: "var(--background-modifier-border)", "stroke-width": stroke } });
  let offset = 0;
  if (total > 0) {
    for (const s of slices) {
      if (s.value <= 0) continue;
      const len = (s.value / total) * c;
      const circle = svg.createSvg("circle", {
        attr: {
          cx: size / 2,
          cy: size / 2,
          r,
          fill: "none",
          stroke: s.color,
          "stroke-width": stroke,
          "stroke-dasharray": `${len} ${c - len}`,
          "stroke-dashoffset": String(-offset),
          transform: `rotate(-90 ${size / 2} ${size / 2})`,
        },
      });
      circle.setAttribute("aria-label", `${s.label} ${Math.round((s.value / total) * 100)}%`);
      circle.setAttribute("role", "img");
      offset += len;
    }
  }
  const t = svg.createSvg("text", { cls: "lubi-donut-center", attr: { x: size / 2, y: size / 2 + (centerSub ? -2 : 6), "text-anchor": "middle" } });
  t.textContent = centerText;
  if (centerSub) {
    const s = svg.createSvg("text", { cls: "lubi-donut-sub", attr: { x: size / 2, y: size / 2 + 16, "text-anchor": "middle" } });
    s.textContent = centerSub;
  }
  return svg;
}

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number): (...a: A) => void {
  let t: number | null = null;
  return (...a: A) => {
    if (t) window.clearTimeout(t);
    t = window.setTimeout(() => fn(...a), ms);
  };
}

export function stopAll(e: Event): void {
  e.preventDefault();
  e.stopPropagation();
}

/** 带「撤销」按钮的 Notice */
export function undoNotice(text: string, onUndo: () => void | Promise<void>, ms = 6000): void {
  const n = new Notice("", ms) as Notice & { noticeEl?: HTMLElement };
  if (!n.noticeEl) return;
  n.noticeEl.empty();
  n.noticeEl.addClass("lubi-notice");
  n.noticeEl.createSpan({ text });
  const b = n.noticeEl.createEl("button", { cls: "lubi-notice-btn", text: "撤销" });
  b.addEventListener("click", (e) => {
    stopAll(e);
    n.hide();
    void onUndo();
  });
}

