// Update UI regression: synthetic public release responses, no real Vault/network writes.
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import * as O from '../helpers/mock-obsidian.js';
const load = Module._load;
Module._load = function(id, ...args) { return id === 'obsidian' ? O : load.call(this, id, ...args); };
const Plugin = createRequire(import.meta.url)(process.env.LUBI_TEST_PLUGIN || '../.out/plugin.cjs').default;
const plugin = new Plugin(new O.App(), { id: 'lubi', version: '1.7.0' });
await plugin.onload();
let writes = 0, requests = 0;
plugin.saveSettings = async () => { writes++; };
const tab = plugin.settingTabs[0];
document.body.append(tab.containerEl);
const root = tab.containerEl;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const button = () => root.querySelector('[data-lubi-update]');
const status = () => root.querySelector('[role=status]').textContent;
const link = () => root.querySelector('.external-link');
const release = tag => ({ status: 200, json: { tag_name: tag, draft: false, prerelease: false, html_url: 'https://untrusted.invalid/' } });
O.setRequestUrlHandler(() => { requests++; return release('1.8.0'); });
tab.display();
assert.equal(requests, 0, 'opening settings does not send a request');
assert(root.textContent.includes('当前运行版本：1.7.0'));
assert.equal(button().textContent, '检查更新');
let resolveRequest;
O.setRequestUrlHandler(options => {
  requests++;
  assert.equal(options.url, 'https://api.github.com/repos/wilsoncslearn/obsidian_task_kanban/releases/latest');
  assert.equal(options.method, 'GET');
  assert.deepEqual(options.headers, { Accept: 'application/vnd.github+json' });
  assert.equal(options.body, undefined, 'no settings or credentials in request');
  return new Promise(resolve => { resolveRequest = resolve; });
});
button().click(); button().click();
assert.equal(requests, 1, 'repeated click does not duplicate requests');
assert(button().disabled); assert.equal(button().textContent, '处理中…');
tab.display(); button().click();
assert(button().disabled); assert.equal(requests, 1, 'redraw does not duplicate requests');
resolveRequest(release('1.8.0')); await tick();
assert(!button().disabled, 'redrawn button recovers after request');
assert(status().includes('发现新版本'), 'result appears in redrawn settings');
for (const [tag, newer] of [['1.8.0',true],['v1.10.0',true],['1.7.0',false],['1.6.9',false],['2.0.0',true],['1.7.1',true]]) {
  tab.display(); O.setRequestUrlHandler(() => release(tag));
  button().click(); await tick();
  assert(status().includes(newer ? '发现新版本' : '无需更新'), tag);
  assert(!button().disabled); assert.equal(button().textContent, '检查更新');
  if (newer) {
    assert.equal(link().getAttribute('href'), 'https://github.com/wilsoncslearn/obsidian_task_kanban/releases/tag/'+tag);
    assert(status().includes('保留 data.json')); assert(status().includes('最低 Obsidian'));
  } else assert.equal(link().getAttribute('href'), 'https://github.com/wilsoncslearn/obsidian_task_kanban/releases');
}
for (const [response, message] of [
  [{status:404},'找不到公开的正式版本'], [{status:403},'请求受限'], [{status:429},'请求受限'], [{status:500},'HTTP 500'],
  [release('nightly'),'版本号格式无法识别'], [release('1.8.0-beta.1'),'版本号格式无法识别'],
  [release('9007199254740992.0.0'),'超出支持范围'],
  [{status:200,json:{tag_name:'1.8.0',draft:false,prerelease:true}},'发布信息无效'],
  [{status:200,json:{tag_name:'1.8.0',draft:true,prerelease:false}},'发布信息无效'],
  [{status:200,json:null},'发布信息无效'],
]) {
  O.setRequestUrlHandler(() => response); button().click(); await tick();
  assert(status().includes(message), status()); assert(!button().disabled);
  assert.equal(link().textContent, '版本发布页', 'failure clears previous download link');
}
O.setRequestUrlHandler(() => { throw new Error('synthetic offline'); });
button().click(); await tick(); assert(status().includes('synthetic offline')); assert(!button().disabled);
const nativeTimeout = global.setTimeout;
global.setTimeout = (fn, delay, ...args) => nativeTimeout(fn, delay === 15000 ? 5 : delay, ...args);
try {
  O.setRequestUrlHandler(() => new Promise(() => {}));
  button().click(); await new Promise(resolve => nativeTimeout(resolve, 25));
  assert(status().includes('请求超时')); assert(!button().disabled);
} finally { global.setTimeout = nativeTimeout; }
O.setRequestUrlHandler(() => new Promise(resolve => { resolveRequest = resolve; }));
button().click(); root.empty(); resolveRequest(release('1.8.0')); await tick();
tab.display(); assert(!button().disabled, 'closing/clearing settings during a request is safe');
assert.equal(writes, 0, 'update check does not persist or change user settings');
plugin.onunload();
console.log('ok   plugin update: on-demand request, numeric versions, trusted links, redraw, errors, timeout and no settings writes');
