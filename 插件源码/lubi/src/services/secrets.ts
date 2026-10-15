import type { App } from "obsidian";

/**
 * Key for AI requests: a key typed in this session wins; otherwise the secret picked from Obsidian's keychain.
 * Read on every request, so a key changed in the keychain applies without a restart.
 */
export function aiKey(app: App, settings: { aiApiKey: string; aiKeySecret?: string }): string {
  if (settings.aiApiKey) return settings.aiApiKey;
  const store = (app as Partial<App>).secretStorage;
  if (!settings.aiKeySecret || !store) return "";
  try {
    return store.getSecret(settings.aiKeySecret) ?? "";
  } catch {
    return "";
  }
}
