import esbuild from "esbuild";
import process from "process";
import fs from "fs";

const prod = process.argv[2] === "production";
// --vault：输出到本仓库 Vault 的已安装插件目录；该目录有 .hotreload，hot-reload 插件会在文件变化后自动重载 Lubi。
const vault = process.argv.includes("--vault");
const outdir = process.env.LUBI_OUT || (vault ? "../../.obsidian/plugins/lubi" : ".");
const assets = ["manifest.json", "styles.css"];

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "node:*", "@codemirror/*", "@lezer/*"],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: `${outdir}/main.js`,
  minify: prod,
  keepNames: true,
});

if (prod) {
  await ctx.rebuild();
  for (const f of assets) if (outdir !== ".") fs.copyFileSync(f, `${outdir}/${f}`);
  process.exit(0);
} else {
  // styles.css / manifest.json 不在 esbuild 依赖图里，watch 不会因它们重建：单独监听并同步到输出目录。
  // 只在 mtime 变化时复制，避免读取文件刷新访问时间后反复触发复制和插件重载。
  if (outdir !== ".") {
    fs.mkdirSync(outdir, { recursive: true });
    const sync = (f) => {
      try {
        fs.copyFileSync(f, `${outdir}/${f}`);
        console.log(`[lubi] 已同步 ${f}`);
      } catch (e) {
        console.warn(`[lubi] 同步 ${f} 失败：${e.message}`);
      }
    };
    for (const f of assets) {
      sync(f);
      fs.watchFile(f, { interval: 300 }, (curr, prev) => { if (curr.mtimeMs !== prev.mtimeMs) sync(f); });
    }
  }
  await ctx.watch();
}
