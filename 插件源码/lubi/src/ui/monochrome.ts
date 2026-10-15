// MONO display tokens; this module never modifies the category configuration.
import type { LubiSettings } from "../settings";

const tones = ["var(--color-ink)", "var(--color-muted)", "var(--color-control-border)", "var(--color-border)", "var(--color-surface)"];

export function categoryTone(settings: LubiSettings, name: string): string {
  const index = settings.categories.findIndex(category => category.name === name);
  return tones[Math.max(0, index) % tones.length];
}
