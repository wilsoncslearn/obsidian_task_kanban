// Computed-style snapshots of the generated preview pages, used to prove a CSS refactor changes nothing.
// 1. npm run test:build && node test/helpers/preview.mjs
// 2. node scripts/style-snapshot.mjs test/.out/before.json      (repeat after the CSS change with another name)
// 3. node scripts/style-snapshot.mjs --compare test/.out/before.json test/.out/after.json
// Each element is reduced to a hash of every computed property (plus ::before/::after); pages run in light and dark
// themes at 1400px and 390px. Add --detail <page@width> to print full property lists for one page instead of hashes.
// --swap-css <old.css> <new.css> replaces the stylesheet inlined in each page, so both snapshots share the same DOM.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { findBrowser } from "../test/helpers/browser.mjs";
import { writePage } from "../test/helpers/page.mjs";

const args = process.argv.slice(2);
if (args[0] === "--compare") {
  // --ignore <regex>: skip elements whose path matches, e.g. the time-dependent "now" line in Gantt charts.
  const ignoreAt = args.indexOf("--ignore"), ignore = ignoreAt > 0 ? new RegExp(args[ignoreAt + 1]) : null;
  const keep = (lines) => (ignore ? lines.filter((l) => !ignore.test(l.split("\t")[0])) : lines);
  const [a, b] = args.slice(1, 3).map((f) => JSON.parse(readFileSync(f, "utf8")));
  for (const k of Object.keys(a)) a[k] = keep(a[k]);
  for (const k of Object.keys(b)) b[k] = keep(b[k]);
  let pages = 0, changed = 0;
  for (const key of Object.keys(a)) {
    pages++;
    const x = a[key], y = b[key];
    if (!y) { console.log(`missing in second snapshot: ${key}`); changed++; continue; }
    const diff = x.filter((line, i) => line !== y[i]);
    if (x.length !== y.length || diff.length) { changed++; console.log(`${key}: ${diff.length} element(s) differ${x.length !== y.length ? `, ${x.length} vs ${y.length} elements` : ""}; first: ${diff.slice(0, 3).map((l) => l.split("\t")[0]).join(" | ")}`); }
  }
  console.log(changed ? `DIFF ${changed} of ${pages} page/width snapshots changed` : `SAME all ${pages} page/width snapshots identical`);
  process.exit(changed ? 1 : 0);
}

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const option = (name, count = 1) => { const i = args.indexOf(name); return i < 0 ? null : args.slice(i + 1, i + 1 + count); };
const detail = option("--detail")?.[0] ?? null;
const swap = option("--swap-css", 2)?.map((f) => readFileSync(f, "utf8")) ?? null;
const consumed = new Set([detail, ...(option("--swap-css", 2) ?? [])]);
const out = args.find((a) => !a.startsWith("--") && !consumed.has(a));
const browser = findBrowser();
if (!browser) throw new Error("Chrome / Edge not found; set LUBI_BROWSER");
const preview = join(root, "preview");
const names = readdirSync(join(preview, "dark")).filter((f) => f.endsWith(".html") && existsSync(join(preview, f))).sort();
const widths = [1400, 390];
const probe = `<style>*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}</style><script>
addEventListener('load',()=>{
  const detail=${JSON.stringify(Boolean(detail))};
  const hash=s=>{let h=0x811c9dc5;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193)>>>0;}return h.toString(16);};
  const path=el=>{const parts=[];for(let e=el;e&&e.nodeType===1;e=e.parentElement){const i=e.parentElement?[...e.parentElement.children].indexOf(e):0;parts.unshift(e.tagName.toLowerCase()+(e.className&&typeof e.className==='string'?'.'+e.className.trim().split(/\\s+/).slice(0,2).join('.'):'')+':'+i);}return parts.join('>');};
  // Chrome lists custom properties in no stable order, so sort before hashing.
  const props=(cs,prefix)=>{const list=[];for(let i=0;i<cs.length;i++){const p=cs[i];list.push(prefix+p+':'+cs.getPropertyValue(p));}return list.sort().join(';')+';';};
  const lines=[];
  for(const el of [document.documentElement,...document.querySelectorAll('body *')]){
    if(el.closest('script,style,#lubi-style-snapshot'))continue;
    let s=props(getComputedStyle(el),'');
    for(const pseudo of ['::before','::after']){const ps=getComputedStyle(el,pseudo);if(ps.content&&ps.content!=='none'&&ps.content!=='normal')s+=props(ps,pseudo);}
    lines.push(path(el)+'\\t'+(detail?s:hash(s)));
  }
  const data=encodeURIComponent(JSON.stringify(lines));
  if(window.parent!==window)window.parent.postMessage(data,'*');
  else{const pre=document.createElement('pre');pre.id='lubi-style-snapshot';pre.textContent=data;document.body.appendChild(pre);}
});</script>`;

const tmp = mkdtempSync(join(tmpdir(), "lubi-style-snapshot-"));
const jobs = [];
for (const theme of ["light", "dark"]) for (const name of names) for (const width of widths) {
  const key = `${theme}/${name}@${width}`;
  if (detail && key !== detail) continue;
  jobs.push({ key, theme, name, width });
}
const result = {};
const run = (job) => new Promise((resolve, reject) => {
  let html = readFileSync(join(preview, job.theme === "dark" ? "dark" : "", job.name), "utf8");
  if (swap) {
    if (!html.includes(swap[0])) return reject(new Error(`stylesheet to swap not found in ${job.key}`));
    html = html.replace(swap[0], () => swap[1]);
  }
  html = html.replace("</body>", probe + "</body>");
  // Render inside a fixed-width iframe: headless Chrome does not reliably honour narrow window sizes,
  // while an iframe gives media and container queries an exact viewport width.
  const child = join(tmp, `${job.theme}-${job.width}-child-${job.name}`);
  writePage(child, html);
  const file = join(tmp, `${job.theme}-${job.width}-${job.name}`);
  writePage(file, `<!doctype html><html><head></head><body style="margin:0"><pre id="lubi-style-snapshot"></pre><iframe src="${pathToFileURL(child).href}" style="display:block;border:0;width:${job.width}px;height:900px"></iframe><script>addEventListener('message',e=>{document.getElementById('lubi-style-snapshot').textContent=e.data;});</script></body></html>`);
  const profile = join(tmp, `profile-${job.theme}-${job.width}-${job.name}`);
  const proc = spawn(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--force-device-scale-factor=1",
    "--window-size=1440,1000", "--virtual-time-budget=5000", "--allow-file-access-from-files", `--user-data-dir=${profile}`, "--dump-dom", pathToFileURL(file).href]);
  let dom = "";
  proc.stdout.on("data", (d) => { dom += d; });
  proc.on("error", reject);
  proc.on("close", () => {
    const m = /<pre id="lubi-style-snapshot">([^<]+)<\/pre>/.exec(dom);
    if (!m) return reject(new Error(`no snapshot for ${job.key}`));
    result[job.key] = JSON.parse(decodeURIComponent(m[1]));
    resolve();
  });
});
const queue = [...jobs];
await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) await run(queue.shift()); }));
try { rmSync(tmp, { recursive: true, force: true }); } catch { /* Chrome may still hold the profile briefly on Windows. */ }
const ordered = Object.fromEntries(Object.keys(result).sort().map((k) => [k, result[k]]));
if (detail) { console.log(ordered[detail].join("\n")); process.exit(0); }
writeFileSync(out, JSON.stringify(ordered));
console.log(`snapshot: ${Object.keys(ordered).length} page/width combinations, ${Object.values(ordered).reduce((n, l) => n + l.length, 0)} elements -> ${out}`);
