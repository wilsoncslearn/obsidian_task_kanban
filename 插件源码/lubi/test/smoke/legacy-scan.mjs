// Startup scan for legacy journal cards: skipped once a scan found nothing; the command still scans. Synthetic in-memory Vault only.
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import * as O from '../helpers/mock-obsidian.js';
import { legacyJournal } from '../helpers/fixtures.mjs';
const load = Module._load; Module._load = function (id, ...args) { return id === 'obsidian' ? O : load.call(this, id, ...args); };
const Plugin = createRequire(import.meta.url)(process.env.LUBI_TEST_PLUGIN || '../.out/plugin.cjs').default;
const tick = () => new Promise((resolve) => setTimeout(resolve, 30));
const confirms = () => O.openModals.filter((m) => m.constructor.name === 'ConfirmModal');

const app = new O.App(), plugin = new Plugin(app, { id: 'lubi', version: '1.8.0' });
await plugin.onload();
for (const fn of app.workspace._ready) await fn();
await tick();
assert.equal(plugin.settings.legacyScanDone, true, 'an empty startup scan records the flag');
assert.equal(plugin._data?.legacyScanDone, true, 'the flag is saved');

await app.vault.create('日记/2026-09-24.md', legacyJournal);
await plugin.runMigration(false);
await tick();
assert.equal(confirms().length, 0, 'startup no longer scans once the flag is set');
assert(app.vault.files.get('日记/2026-09-24.md').includes('journal-card'), 'startup leaves files untouched');

await plugin.runMigration(true);
await tick();
const migrated = app.vault.files.get('日记/2026-09-24.md');
assert(migrated.includes('## 记录') && !migrated.includes('journal-card'), 'the command still scans and migrates');

const fresh = new O.App(), second = new Plugin(fresh, { id: 'lubi', version: '1.8.0' });
second.loadData = async () => ({ legacyScanDone: true });
await second.onload();
await fresh.vault.create('日记/2026-09-24.md', legacyJournal);
for (const fn of fresh.workspace._ready) await fn();
await tick();
assert.equal(confirms().length, 0, 'a saved flag skips the scan after restart');
console.log('PASS legacy scan flag: set after an empty scan, startup skips the scan, the command still migrates, flag survives restart');
