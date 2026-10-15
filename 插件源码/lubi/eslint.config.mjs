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
]);
