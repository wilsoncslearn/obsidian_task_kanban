// AI key from Obsidian's keychain (SecretStorage). Synthetic secret and HTTP only; data.json keeps just the secret name.
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import * as O from '../helpers/mock-obsidian.js';
const load = Module._load; Module._load = function (id, ...args) { return id === 'obsidian' ? O : load.call(this, id, ...args); };
const Plugin = createRequire(import.meta.url)(process.env.LUBI_TEST_PLUGIN || '../.out/plugin.cjs').default;
const wait = () => new Promise((resolve) => setTimeout(resolve, 100));

const app = new O.App(), plugin = new Plugin(app, { id: 'lubi', version: '1.8.0' });
await plugin.onload();
app.secretStorage.setSecret('lubi-ai-key', 'SYNTHETIC_KEYCHAIN_SECRET');
plugin.settings.aiEndpoint = 'https://synthetic.invalid/v1';
plugin.settings.aiModel = 'synthetic-model';
const tab = plugin.settingTabs[0];
document.body.append(tab.containerEl);
tab.display();
const root = tab.containerEl;
root.querySelector('.lubi-settings-ai').open = true;

const picker = root.querySelector('.lubi-mock-secret');
assert(picker, 'the keychain picker is rendered');
picker.value = 'lubi-ai-key';
picker.dispatchEvent(new window.Event('change', { bubbles: true }));
await wait();
assert.equal(plugin.settings.aiKeySecret, 'lubi-ai-key');
assert.equal(plugin._data?.aiKeySecret, 'lubi-ai-key', 'only the secret name is saved');
assert(!JSON.stringify(plugin._data).includes('SYNTHETIC_KEYCHAIN_SECRET'), 'the key never reaches data.json');

let auth;
O.setRequestUrlHandler((options) => { auth = options.headers?.Authorization; return { status: 200, json: { data: [{ id: 'synthetic-model' }] } }; });
const fetchModels = () => [...root.querySelectorAll('button')].find((b) => b.textContent === '获取模型列表');
fetchModels().click();
await wait();
assert.equal(auth, 'Bearer SYNTHETIC_KEYCHAIN_SECRET', 'requests use the keychain key');

app.secretStorage.setSecret('lubi-ai-key', 'ROTATED_KEYCHAIN_SECRET');
fetchModels().click();
await wait();
assert.equal(auth, 'Bearer ROTATED_KEYCHAIN_SECRET', 'a key changed in the keychain applies without a restart');

const input = root.querySelector('[data-setting=ai-key]');
input.value = 'SESSION_ONLY_KEY';
input.dispatchEvent(new window.Event('input', { bubbles: true }));
await wait();
fetchModels().click();
await wait();
assert.equal(auth, 'Bearer SESSION_ONLY_KEY', 'a key typed this session takes priority');
assert(!JSON.stringify(plugin._data).includes('SESSION_ONLY_KEY'), 'the session key is not saved');
console.log('PASS keychain AI key: picker saves only the secret name, requests read the keychain each time, session key wins, no key in data.json');
