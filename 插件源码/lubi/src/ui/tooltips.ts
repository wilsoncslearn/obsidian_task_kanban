// Lubi 专用悬停系统；不修改其他插件的提示或全局 .tooltip 样式。
type Rows = (string | HTMLElement)[];
const scope = ".lubi-root, .lubi-modal, .lubi-settings, .lubi-tooltip-scope";
// 清单内容已直接展示；只保留可访问名称，不重复弹出提示。
const listNames = '.lubi-task .lubi-task-title, .lubi-task .lubi-task-meta, .lubi-task > input[type="checkbox"]';
// 已有文字或常见图标足以表达用途；静默子元素也不触发父级详情卡。
const quietControls = [
  ".lubi-root .lubi-topbar button", ".lubi-root .lubi-planning-head button", ".lubi-root .lubi-inbox-add",
  ".lubi-quiet-action", ".lubi-modal .lubi-kind-seg button", ".lubi-root .lubi-plan-progress",
  ".lubi-root .lubi-gantt-collapse", ".lubi-root .lubi-review .lubi-toolbar .lubi-nav button.lubi-icon-btn",
  ".lubi-settings .lubi-model-toggle", ".lubi-root .lubi-task-group-title", ".lubi-modal .lubi-cat-option",
  ".lubi-modal .lubi-quick-chip-warn.lubi-switch", ".lubi-settings .lubi-category-up",
  ".lubi-settings .lubi-category-remove", ".lubi-root .lubi-gap-row-add",
].join(", ");
const rich = new WeakMap<Element, { rows: () => Rows | null; placement: "pointer" | "side" }>();
let tipEl: HTMLElement | null = null;
let pending: number | null = null;
let current: Element | null = null;
let labelId = 0;

export function hideTip(): void {
  if (pending !== null) window.clearTimeout(pending);
  pending = null;
  tipEl?.remove(); tipEl = null; current = null;
}

/** 可访问名称与视觉提示共用文字，但不留会触发 Obsidian 黑框的 aria-label。 */
function normalize(el: Element): void {
  if (!el.closest(scope)) return;
  const listName = el.matches(listNames) || el.matches(quietControls);
  if (listName) el.removeAttribute("data-lubi-tip");
  const label = el.getAttribute("aria-label") || el.getAttribute("title");
  if (!label) return;
  // 输入框及区域标签只是无障碍名称，不应凭空变成悬停提示。
  const nameOnly = listName || el.matches('textarea, select, input:not([type="checkbox"]):not([type="radio"]), [role="status"], [role="grid"], [role="group"], .lubi-plan-lane, .lubi-review-signals');
  const oldLabel = el.getAttribute("data-lubi-label-id");
  if (oldLabel) document.getElementById(oldLabel)?.remove();
  const svg = el.namespaceURI === "http://www.w3.org/2000/svg";
  const description = svg ? document.createElementNS(el.namespaceURI, "desc") : document.createElement("span");
  description.id = `lubi-tooltip-label-${++labelId}`;
  description.textContent = label;
  if (!svg) description.classList.add("lubi-sr-only");
  if (el.matches("input, textarea, select")) el.parentElement?.appendChild(description);
  else el.appendChild(description);
  el.setAttribute("aria-labelledby", description.id);
  el.setAttribute("data-lubi-label-id", description.id);
  el.removeAttribute("aria-label"); el.removeAttribute("title");
  if (!nameOnly && !rich.has(el)) {
    const hint = el.matches(".lubi-task-start") ? "记录本人实际，可选择完成"
      : el.matches(".lubi-task-unlogged") ? "按计划补记待确认记录，不改变完成状态" : label;
    el.setAttribute("data-lubi-tip", hint);
  }
}
export function setTipLabel(el: HTMLElement, text: string): void {
  el.setAttribute("data-lubi-tip", text);
  el.setAttribute("aria-label", text);
  el.removeAttribute("title");
  normalize(el);
}
export function hoverTip(host: HTMLElement, selector: string, content: (target: HTMLElement) => Rows | null, placement: "pointer" | "side" = "pointer"): void {
  const targets = Array.from(host.querySelectorAll<HTMLElement>(selector));
  if (host.matches(selector)) targets.unshift(host);
  for (const el of targets) rich.set(el, { rows: () => content(el), placement });
}
/** 分层信息卡：仅显示标题、数据与可选备注。 */
export function infoTip(el: HTMLElement, title: string, details: string[], notes = ""): void {
  setTipLabel(el, [title, ...details, notes].filter(Boolean).join("。"));
  rich.set(el, { placement: "side", rows: () => {
    const rows: Rows = [createDiv({ cls: "lubi-task-tip-title", text: title }), ...details];
    if (notes.trim()) rows.push(createDiv({ cls: "lubi-task-tip-notes", text: notes }));
    return rows;
  } });
}
function place(el: Element, x: number, y: number): void {
  if (!tipEl) return;
  const rect = el.getBoundingClientRect(), w = tipEl.offsetWidth, h = tipEl.offsetHeight;
  const side = rich.get(el)?.placement !== "pointer";
  let left = side ? rect.right + 10 : x + 14;
  let top = side ? rect.top : y + 14;
  if (left + w > window.innerWidth - 8) left = (side ? rect.left : x) - w - 10;
  if (top + h > window.innerHeight - 8) top = window.innerHeight - h - 8;
  tipEl.style.left = `${Math.max(8, Math.min(left, window.innerWidth - w - 8))}px`;
  tipEl.style.top = `${Math.max(8, top)}px`;
}
function show(el: Element, x: number, y: number): void {
  if (!el.isConnected || current !== el) return;
  const rows = rich.get(el)?.rows() || [el.getAttribute("data-lubi-tip") || ""];
  if (!rows.length || (rows.length === 1 && rows[0] === "")) return;
  tipEl?.remove();
  tipEl = document.body.createDiv({ cls: rich.has(el) ? "lubi-tip" : "lubi-tip is-label", attr: { role: "tooltip" } });
  for (const row of rows) {
    if (typeof row === "string") tipEl.createDiv({ text: row });
    else tipEl.appendChild(row);
  }
  place(el, x, y);
}
export function installTooltips(): () => void {
  const listeners: (() => void)[] = [];
  const listen = (target: EventTarget, type: string, handler: EventListener) => {
    target.addEventListener(type, handler, true);
    listeners.push(() => target.removeEventListener(type, handler, true));
  };
  const scan = (node: Element) => {
    normalize(node);
    node.querySelectorAll("[aria-label], [title]").forEach(normalize);
  };
  document.querySelectorAll(scope).forEach(scan);
  const observer = new window.MutationObserver(records => {
    for (const record of records) {
      if (record.type === "attributes") normalize(record.target as Element);
      else record.addedNodes.forEach(node => { if (node instanceof window.Element) scan(node); });
    }
    if (current && !current.isConnected) hideTip();
  });
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-label", "title"] });
  const targetOf = (event: Event): Element | null => {
    if (!(event.target instanceof window.Element) || !event.target.closest(scope)) return null;
    const nameOnly = !!event.target.closest(`${listNames}, ${quietControls}`);
    const suspended = document.body.classList.contains("lubi-dragging") || !!event.target.closest("[data-lubi-tip-suspended]");
    let el: Element | null = event.target;
    while (el && el.closest(scope)) {
      normalize(el); // 在 Obsidian 的冒泡监听之前去掉原生提示属性。
      if (!suspended && !nameOnly && (rich.has(el) || el.hasAttribute("data-lubi-tip"))) return el;
      el = el.parentElement;
    }
    return null;
  };
  listen(document, "pointermove", (event) => {
    const e = event as PointerEvent, el = targetOf(e);
    if (!el || e.buttons) { hideTip(); return; }
    if (el === current) { if (tipEl) place(el, e.clientX, e.clientY); return; }
    hideTip(); current = el;
    pending = window.setTimeout(() => { pending = null; show(el, e.clientX, e.clientY); }, 250);
  });
  listen(document, "pointerover", event => { targetOf(event); });
  listen(document, "pointerout", event => {
    const e = event as PointerEvent;
    const suspended = e.target instanceof window.Element ? e.target.closest("[data-lubi-tip-suspended]") : null;
    if (suspended && suspended.getAttribute("data-lubi-tip-suspended") !== "pending" && !document.body.classList.contains("lubi-dragging") && (!(e.relatedTarget instanceof window.Node) || !suspended.contains(e.relatedTarget))) suspended.removeAttribute("data-lubi-tip-suspended");
    if (current && (!(e.relatedTarget instanceof window.Node) || !current.contains(e.relatedTarget))) hideTip();
  });
  listen(document, "pointerleave", event => { if (current && event.target instanceof window.Node && (event.target === current || event.target.contains(current))) hideTip(); });
  listen(document, "focusin", event => {
    const el = targetOf(event); hideTip();
    if (el) { current = el; const rect = el.getBoundingClientRect(); show(el, rect.right, rect.top); }
  });
  listen(document, "focusout", () => hideTip());
  for (const type of ["scroll", "pointerdown", "dragstart", "keydown"]) listen(document, type, () => hideTip());
  listen(window, "blur", () => hideTip());
  return () => { observer.disconnect(); listeners.forEach(remove => remove()); hideTip(); };
}
