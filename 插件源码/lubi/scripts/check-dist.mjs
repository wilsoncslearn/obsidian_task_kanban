// Verify that the Vault copy of Lubi matches a fresh production build.
// Usage: npm run check:dist   (runs the production build first, then compares files)
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const vault = join(root, "..", "..", ".obsidian", "plugins", "lubi");
const files = ["main.js", "styles.css", "manifest.json"];
const digest = (file) => createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 16);
const readJson = (file) => JSON.parse(readFileSync(join(root, file), "utf8"));
const problems = [];

for (const name of files) {
  const built = join(root, name), shipped = join(vault, name);
  if (!existsSync(built)) { problems.push(`${name}：缺少构建产物，请先运行 npm run build`); continue; }
  if (!existsSync(shipped)) { problems.push(`${name}：Vault 中缺少分发文件 ${relative(root, shipped)}`); continue; }
  const fresh = digest(built), current = digest(shipped);
  if (fresh !== current) problems.push(`${name}：Vault 分发文件（${current}）与当前生产构建（${fresh}）不一致，请运行 npm run build:vault`);
}

const shippedMain = join(vault, "main.js");
if (existsSync(shippedMain) && readFileSync(shippedMain, "utf8").includes("sourceMappingURL=")) {
  problems.push("main.js：含 sourcemap，是开发版构建，请运行 npm run build:vault");
}
if (existsSync(shippedMain) && statSync(shippedMain).size >= 1024 * 1024) {
  problems.push(`main.js：${(statSync(shippedMain).size / 1024 / 1024).toFixed(2)} MB，超过 1 MB，疑似开发版构建`);
}

const manifest = readJson("manifest.json"), versions = readJson("versions.json"), pkg = readJson("package.json");
if (pkg.version !== manifest.version) problems.push(`版本不一致：package.json ${pkg.version}，manifest.json ${manifest.version}`);
if (versions[manifest.version] !== manifest.minAppVersion) {
  problems.push(`versions.json 中 ${manifest.version} 应对应最低 Obsidian 版本 ${manifest.minAppVersion}`);
}

if (problems.length) {
  console.error(problems.map((line) => `✗ ${line}`).join("\n"));
  process.exit(1);
}
console.log(`check:dist 通过：Vault 分发文件与生产构建一致（${files.map((name) => `${name} ${digest(join(root, name))}`).join("，")}）`);
