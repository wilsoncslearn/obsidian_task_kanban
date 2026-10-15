import { Notice } from "obsidian";

// Shared helpers for form fields and inline errors in the record and task forms.

let fieldId = 0;

/** Next number for unique element ids; shared by every form. */
export function nextFieldId(): number {
  return ++fieldId;
}

export function associate(label: HTMLLabelElement, control: HTMLElement): void {
  const id = `lubi-field-${++fieldId}`;
  label.htmlFor = id;
  control.id = id;
}
function errorHost(control: HTMLElement): HTMLElement | null {
  return (control.closest(".lubi-field") as HTMLElement | null)
    || (control.closest(".lubi-timebar-dur")?.parentElement as HTMLElement | null)
    || control.parentElement;
}
export function fieldError(control: HTMLInputElement | HTMLSelectElement | undefined, message: string): void {
  if (!control) { new Notice(message); return; }
  const host = errorHost(control);
  host?.querySelector(".lubi-field-error")?.remove();
  const id = `lubi-error-${++fieldId}`;
  host?.createDiv({ cls: "lubi-field-error", text: message, attr: { id, role: "alert" } });
  control.setAttribute("aria-invalid", "true");
  control.setAttribute("aria-describedby", id);
  const disclosure = control.closest("details");
  if (disclosure) disclosure.open = true;
  control.focus();
}
export function clearFieldError(control: HTMLElement): void {
  const host = errorHost(control);
  host?.querySelector(".lubi-field-error")?.remove();
  control.removeAttribute("aria-invalid");
  control.removeAttribute("aria-describedby");
}
export function formError(host: HTMLElement, message: string): void {
  let error = host.querySelector<HTMLElement>(".lubi-modal-error");
  if (!error) {
    error = host.createDiv({ cls: "lubi-modal-error", attr: { role: "alert", tabindex: "-1" } });
    host.querySelector(".lubi-modal-actions")?.before(error);
  }
  error.setText(message);
  error.focus();
}
