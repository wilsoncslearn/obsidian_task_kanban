import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import Module, { createRequire } from 'node:module';
import * as O from '../helpers/mock-obsidian.js';
const originalLoad = Module._load;
Module._load = function(id,...args) { return id==='obsidian' ? O : originalLoad.call(this,id,...args); };
const require=createRequire(import.meta.url), { installPluginUpdate,checkPluginUpdate }=require('../.out/update-core.cjs');
const productionPath=process.env.LUBI_TEST_PLUGIN ? require.resolve(process.env.LUBI_TEST_PLUGIN) : new URL('../.out/plugin.cjs',import.meta.url);
const productionSource=await fs.readFile(productionPath,'utf8');
const wrappedModule={exports:{}};
new Function('require','module','exports',productionSource)(id=>id==='obsidian'?O:require(id),wrappedModule,wrappedModule.exports);
const Plugin=wrappedModule.exports.default;
// The installer works on realpath'd folders; on Windows os.tmpdir() can be an 8.3 short path, so resolve it once.
const tmp=await fs.realpath(os.tmpdir());
const root=await fs.mkdtemp(path.join(tmp,'lubi-updater-test-'));
const native={readFile:fs.readFile,writeFile:fs.writeFile,rename:fs.rename,mkdtemp:fs.mkdtemp};
const backups=[];
fs.mkdtemp=async (...args)=>{const result=await native.mkdtemp(...args);if(result.startsWith(path.join(tmp,'Lubi-plugin-backups')+path.sep))backups.push(result);return result;};
let serial=0,requests=0;
const prefix='https://github.com/wilsoncslearn/obsidian_task_kanban/releases';
const files=['main.js','styles.css','manifest.json'];
const tag='1.8.0';
const manifest={id:'lubi',version:tag,minAppVersion:'1.4.0',isDesktopOnly:false,name:'Synthetic Lubi'};
const content={'main.js':Buffer.from('module.exports={default:class LubiPlugin{}};'),'styles.css':Buffer.from('.synthetic-new { color: red; }'),'manifest.json':Buffer.from(JSON.stringify(manifest))};
const digest=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
const metadata=(overrides={})=>({tag_name:tag,draft:false,prerelease:false,assets:files.map(name=>({name,state:'uploaded',size:content[name].length,digest:digest(content[name]),browser_download_url:prefix+'/download/'+tag+'/'+name})),...overrides});
let responseMetadata=metadata(), responseContent=content;
const normalHandler=async options=>{
  requests++;
  assert(!options.body&&!options.headers?.Authorization,'no data or credentials sent');
  if(options.url.endsWith('/latest'))return {status:200,json:responseMetadata};
  const name=options.url.split('/').at(-1);
  assert.equal(options.url,prefix+'/download/'+tag+'/'+name,'only pinned repository assets');
  const bytes=responseContent[name];
  return {status:200,arrayBuffer:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
};
async function fixture(){
  responseMetadata=metadata();responseContent=content;requests=0;O.setRequestUrlHandler(normalHandler);
  const vault=path.join(root,String(++serial)),dir=path.join(vault,'.config-test','plugins','lubi');
  await fs.mkdir(dir,{recursive:true});
  const old={'main.js':Buffer.from('old synthetic main'),'styles.css':Buffer.from('old synthetic css'),'manifest.json':Buffer.from(JSON.stringify({...manifest,version:'1.7.0'}))};
  for(const name of files)await fs.writeFile(path.join(dir,name),old[name]);
  const untouched=[['data.json','{"syntheticSetting":"keep"}'],['extra.txt','unknown plugin file'],['../../../../tasks.json','synthetic tasks'],['../../../../journal.md','synthetic journal']];
  // Keep all personal-data stand-ins within the isolated fixture Vault.
  await fs.writeFile(path.join(dir,'data.json'),untouched[0][1]);await fs.writeFile(path.join(dir,'extra.txt'),untouched[1][1]);
  await fs.writeFile(path.join(vault,'tasks.json'),'synthetic tasks');await fs.writeFile(path.join(vault,'journal.md'),'synthetic journal');
  const protectedFiles=[path.join(dir,'data.json'),path.join(dir,'extra.txt'),path.join(vault,'tasks.json'),path.join(vault,'journal.md')];
  const app=new O.App();app.vault.configDir='.config-test';app.vault.adapter=new O.FileSystemAdapter(vault);
  const running={...manifest,version:'1.7.0',dir:'.config-test/plugins/lubi'};
  const release=await checkPluginUpdate(running.version);
  const assertProtected=async()=>{for(let i=0;i<protectedFiles.length;i++)assert.equal((await fs.readFile(protectedFiles[i])).toString(),['{"syntheticSetting":"keep"}','unknown plugin file','synthetic tasks','synthetic journal'][i]);};
  const assertOld=async()=>{for(const name of files)assert.deepEqual(await fs.readFile(path.join(dir,name)),old[name]);await assertProtected();};
  return {app,running,release,dir,vault,old,protectedFiles,assertProtected,assertOld};
}
const install=(f)=>installPluginUpdate(f.app,f.running,f.release,()=>{});
async function expectReject(f,pattern){await assert.rejects(()=>install(f),pattern);await f.assertOld();}
try {
  const f=await fixture(),progress=[];
  const backup=await installPluginUpdate(f.app,f.running,f.release,text=>progress.push(text));
  for(const name of files){assert.deepEqual(await fs.readFile(path.join(f.dir,name)),content[name]);assert.deepEqual(await fs.readFile(path.join(backup,name)),f.old[name]);}
  assert(!backup.startsWith(f.vault+path.sep));assert(progress.some(t=>t.includes('备份')));await f.assertProtected();
  await assert.rejects(()=>fs.stat(path.join(f.dir,'.lubi-update')),/ENOENT/);
  await assert.rejects(()=>install(f),/磁盘插件版本与运行版本不同/);
  console.log('PASS isolated filesystem install: verified external backups, manifest last, only three files changed, pending restart guard');
  for(const scenario of ['network','digest','size','utf8','wrong-id','wrong-version','incompatible']){
    const f=await fixture();
    if(scenario==='network')O.setRequestUrlHandler(()=>({status:503}));
    else {
      const changed={...content};
      if(scenario==='digest')changed['main.js']=Buffer.from('tampered bundle');
      if(scenario==='size')changed['main.js']=Buffer.alloc(content['main.js'].length+1);
      if(scenario==='utf8')changed['main.js']=Buffer.from([255,254]);
      if(scenario==='wrong-id')changed['manifest.json']=Buffer.from(JSON.stringify({...manifest,id:'other'}));
      if(scenario==='wrong-version')changed['manifest.json']=Buffer.from(JSON.stringify({...manifest,version:'1.9.0'}));
      if(scenario==='incompatible')changed['manifest.json']=Buffer.from(JSON.stringify({...manifest,minAppVersion:'99.0.0'}));
      responseContent=changed;
      if(!['digest','size'].includes(scenario)){f.release.assets=f.release.assets.map(a=>({...a,size:changed[a.name].length,digest:digest(changed[a.name])}));}
    }
    await expectReject(f,/更新失败/);
    await assert.rejects(()=>fs.stat(path.join(f.dir,'.lubi-update')),/ENOENT/);
  }
  for(const scenario of ['lower','same','tag','url','missing','duplicate','hash','traversal','old-disk','lock']){
    const f=await fixture();
    if(scenario==='lower')f.release.version='1.6.0';
    if(scenario==='same')f.release.version='1.7.0';
    if(scenario==='tag')f.release.tag='2.0.0';
    if(scenario==='url')f.release.assets[0].url='https://untrusted.invalid/main.js';
    if(scenario==='missing')f.release.assets.pop();
    if(scenario==='duplicate')f.release.assets.push(f.release.assets[0]);
    if(scenario==='hash')f.release.assets[0].digest='sha256:invalid';
    if(scenario==='traversal')f.running.dir='../other/plugins/lubi';
    if(scenario==='old-disk')f.running.version='1.6.0';
    if(scenario==='lock')await fs.mkdir(path.join(f.dir,'.lubi-update'));
    const before=requests;await expectReject(f,/不能安装|无效|缺失|重复|路径|版本不同|暂存目录/);assert.equal(requests,before,'invalid installation starts no downloads');
  }
  console.log('PASS rejected downloads, hashes, UTF-8, manifest identity/version/compatibility, same/older versions, paths, stale disk and interrupted-update lock');
  for(const scenario of ['backup','stage','commit','ambiguous','rollback','external','rollback-conflict']){
    const f=await fixture();let failOnce=true;
    if(scenario==='backup'||scenario==='stage')fs.writeFile=async (file,...args)=>{
      if(failOnce&&String(file).endsWith('styles.css')&&(scenario==='backup'?String(file).startsWith(path.join(tmp,'Lubi-plugin-backups')):String(file).includes('.lubi-update'))){failOnce=false;throw new Error('synthetic write failure');}
      return native.writeFile(file,...args);
    };
    if(['commit','ambiguous','rollback','rollback-conflict'].includes(scenario))fs.rename=async (from,to)=>{
      if(scenario==='ambiguous'&&failOnce&&String(from)===path.join(f.dir,'.lubi-update','main.js')){failOnce=false;await native.rename(from,to);throw new Error('synthetic unknown commit result');}
      if(String(from)===path.join(f.dir,'.lubi-update','styles.css')&&failOnce){failOnce=false;if(scenario==='rollback-conflict')await native.writeFile(path.join(f.dir,'main.js'),'external change during rollback');throw new Error('synthetic commit failure');}
      if(scenario==='rollback'&&String(from).includes('restore-main.js'))throw new Error('synthetic rollback failure');
      return native.rename(from,to);
    };
    if(scenario==='external')O.setRequestUrlHandler(async options=>{if(options.url.endsWith('main.js'))await native.writeFile(path.join(f.dir,'styles.css'),'external styles');return normalHandler(options);});
    try {
      await assert.rejects(()=>install(f),scenario.startsWith('rollback')?/回滚未完成/:['commit','ambiguous'].includes(scenario)?/已恢复旧版本/:/未替换插件文件/);
      await f.assertProtected();
      if(!['external','rollback','rollback-conflict'].includes(scenario))await f.assertOld();
      if(scenario==='external')assert.equal((await fs.readFile(path.join(f.dir,'styles.css'))).toString(),'external styles');
      if(scenario==='rollback-conflict')assert.equal((await fs.readFile(path.join(f.dir,'main.js'))).toString(),'external change during rollback');
      if(scenario.startsWith('rollback'))assert((await fs.stat(path.join(f.dir,'.lubi-update'))).isDirectory(),'failed rollback retains recovery lock and verified backups');
    } finally {fs.writeFile=native.writeFile;fs.rename=native.rename;}
  }
  console.log('PASS backup/staging/commit failures, automatic rollback, rollback conflict preserves external edits and incomplete rollback retains recovery information');
  {
    const f=await fixture();let resolve;
    O.setRequestUrlHandler(options=>options.url.endsWith('main.js')?new Promise(r=>{resolve=()=>normalHandler(options).then(r);}):normalHandler(options));
    const first=install(f);
    while(!resolve)await new Promise(r=>setTimeout(r,5));
    await assert.rejects(()=>install(f),/已有更新正在安装/);resolve();await first;await f.assertProtected();
  }
  {
    const f=await fixture();O.Platform.isDesktopApp=false;
    await expectReject(f,/仅支持桌面/);O.Platform.isDesktopApp=true;
  }
  console.log('PASS installer concurrency and mobile refusal');
  {
    O.Platform.isDesktopApp=false;
    const mobileModule={exports:{}};let nodeLoads=0;
    new Function('require','module','exports',productionSource)(id=>{if(id==='obsidian')return O;nodeLoads++;throw new Error('Node modules unavailable on mobile');},mobileModule,mobileModule.exports);
    const mobile=new mobileModule.exports.default(new O.App(),{id:'lubi',version:'1.7.0'});await mobile.onload();mobile.settingTabs[0].display();
    O.setRequestUrlHandler(normalHandler);mobile.settingTabs[0].containerEl.querySelector('[data-lubi-update]').click();
    await new Promise(r=>setTimeout(r,30));
    assert.equal(nodeLoads,0,'loading/checking mobile plugin never requires Node');
    assert(mobile.settingTabs[0].containerEl.querySelector('[data-lubi-install]').hidden);
    mobile.onunload();O.Platform.isDesktopApp=true;
  }
  console.log('PASS Obsidian-style CommonJS wrapper and mobile loading without Node modules');
  {
    const f=await fixture(),plugin=new Plugin(f.app,f.running);await plugin.onload();let saves=0;plugin.saveSettings=async()=>{saves++;};
    const tab=plugin.settingTabs[0];document.body.append(tab.containerEl);tab.display();
    const check=()=>tab.containerEl.querySelector('[data-lubi-update]'),update=()=>tab.containerEl.querySelector('[data-lubi-install]');
    const settle=async predicate=>{for(let i=0;i<200&&!predicate();i++)await new Promise(r=>setTimeout(r,10));assert(predicate(),'UI did not settle');};
    check().click();await settle(()=>!check().disabled);assert(!update().hidden);
    const before=requests;update().click();update().click();assert.equal(O.openModals.length,1,'single confirmation dialog');assert.equal(requests,before,'confirmation does not download before consent');
    O.openModals[0].close();assert(!check().disabled);await f.assertOld();
    update().click();const modal=O.openModals[0];[...modal.contentEl.querySelectorAll('button')].find(b=>b.textContent==='确认更新').click();
    tab.display();assert(check().disabled,'redraw keeps update busy');
    await settle(()=>tab.containerEl.textContent.includes('已安装 1.8.0'));
    assert(check().disabled&&update().hidden);assert(tab.containerEl.textContent.includes('请重启 Obsidian'));assert.equal(saves,0);
    const count=requests;check().click();assert.equal(requests,count);await f.assertProtected();plugin.onunload();
  }
  console.log('PASS actual production plugin UI: discover, confirm/cancel, duplicate guard, install across redraw, restart state and zero settings writes');
} finally {
  Object.assign(fs,native);O.Platform.isDesktopApp=true;O.setRequestUrlHandler(null);
  // Delete only verified isolated fixtures and directories created by this test.
  assert(path.resolve(root).startsWith(path.resolve(tmp)+path.sep));await fs.rm(root,{recursive:true,force:true});
  for(const backup of backups){assert(path.resolve(backup).startsWith(path.resolve(tmp,'Lubi-plugin-backups')+path.sep));await fs.rm(backup,{recursive:true,force:true});}
}
