// Lint with Obsidian's official recommended rules (eslint-plugin-obsidianmd).
// Report-only for now: run `npm run lint`; CI does not fail on lint yet.
import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  globalIgnores(["main.js", "node_modules/", "preview/", "test/", "scripts/", "esbuild.config.mjs", "eslint.config.mjs"]),
  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    // TypeScript already checks undefined names (require, Buffer); the core rule misreports them.
    rules: { "no-undef": "off" },
  },
  {
    // src/core stays pure logic; Vault I/O, network and updates live in src/services.
    files: ["src/core/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [{ name: "obsidian", message: "src/core 只放纯逻辑；读写 Vault、网络和更新放在 src/services/。" }],
        patterns: [
          { group: ["../services/*", "../ui/*", "../main"], message: "src/core 不能依赖 services、ui 或插件入口。" },
          { group: ["node:*"], message: "src/core 不使用 Node 内置模块。" },
        ],
      }],
    },
  },
]);
