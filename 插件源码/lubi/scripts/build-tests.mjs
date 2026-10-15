// Build the bundles that the tests load into test/.out (ignored by Git).
// Usage: node scripts/build-tests.mjs [core] [plugin] [update]   (default: all three)
import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = join(root, "test", ".out");
const shared = { absWorkingDir: root, bundle: true, platform: "node", logLevel: "warning" };
const targets = {
  // Pure logic for test/core, with a stub in place of the Obsidian API.
  core: { entryPoints: ["test/helpers/entry.ts"], format: "esm", alias: { obsidian: "./test/helpers/stub-obsidian.js" }, outfile: join(out, "core.mjs") },
  // The whole plugin as CommonJS; each test maps require("obsidian") to test/helpers/mock-obsidian.js.
  plugin: { entryPoints: ["src/main.ts"], format: "cjs", external: ["obsidian"], outfile: join(out, "plugin.cjs") },
  // Update check and installer only, for the installer test.
  update: { entryPoints: ["test/helpers/plugin-update-entry.ts"], format: "cjs", external: ["obsidian"], outfile: join(out, "update-core.cjs") },
};

const names = process.argv.slice(2);
for (const name of names.length ? names : Object.keys(targets)) {
  if (!targets[name]) throw new Error(`Unknown test bundle "${name}". Choose from: ${Object.keys(targets).join(", ")}`);
  await build({ ...shared, ...targets[name] });
}
