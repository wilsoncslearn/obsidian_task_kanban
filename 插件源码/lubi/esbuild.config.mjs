import esbuild from "esbuild";
import process from "process";
import fs from "fs";
import path from "path";

const prod = process.argv[2] === "production";
// --vault：输出到本仓库 Vault 的已安装插件目录；该目录有 .hotreload，hot-reload 插件会在文件变化后自动重载 Lubi。
const vault = process.argv.includes("--vault");
const outdir = process.env.LUBI_OUT || (vault ? "../../.obsidian/plugins/lubi" : ".");
const assets = ["manifest.json", "styles.css"];

// styles.css 是生成文件：src/styles/ 下的分段按文件名顺序逐字节拼接而成。改样式请改分段文件。
const styleDir = "src/styles";
const styleParts = () => fs.readdirSync(styleDir).filter((f) => f.endsWith(".css")).sort().map((f) => path.join(styleDir, f));
function buildStyles() {
  const css = Buffer.concat(styleParts().map((f) => fs.readFileSync(f)));
  if (fs.existsSync("styles.css") && fs.readFileSync("styles.css").equals(css)) return false;
  fs.writeFileSync("styles.css", css);
  return true;
}

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

buildStyles();
if (prod) {
  await ctx.rebuild();
  for (const f of assets) if (outdir !== ".") fs.copyFileSync(f, `${outdir}/${f}`);
  process.exit(0);
} else {
  // 样式分段与 manifest.json 不在 esbuild 依赖图里，watch 不会因它们重建：单独监听，再同步到输出目录。
  // 只在 mtime 变化时处理，避免读取文件刷新访问时间后反复触发复制和插件重载。新增分段文件后需重启监听。
  const sync = (f) => {
    if (outdir === ".") return;
    try {
      fs.copyFileSync(f, `${outdir}/${f}`);
      console.log(`[lubi] 已同步 ${f}`);
    } catch (e) {
      console.warn(`[lubi] 同步 ${f} 失败：${e.message}`);
    }
  };
  if (outdir !== ".") {
    fs.mkdirSync(outdir, { recursive: true });
    for (const f of assets) sync(f);
  }
  const onChange = (f, run) => fs.watchFile(f, { interval: 300 }, (curr, prev) => { if (curr.mtimeMs !== prev.mtimeMs) run(); });
  onChange("manifest.json", () => sync("manifest.json"));
  for (const part of styleParts()) {
    onChange(part, () => {
      if (!buildStyles()) return;
      console.log(`[lubi] 已重新生成 styles.css（${path.basename(part)}）`);
      sync("styles.css");
    });
  }
  await ctx.watch();
}
