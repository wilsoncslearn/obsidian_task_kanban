# Lubi 项目速览

本页是基于仓库现有文件的静态梳理，不代表构建、测试或真实 Obsidian 验收。详细架构见 [插件维护文档](mcp-lubi-plugin.md)，用户操作见 [README](../README.md)。

## 定位与入口

- 插件名称为 Lubi 柳比歇夫记录，当前源码 `package.json` 与 `manifest.json` 均为 1.8.0；维护文档称其为未发布的本地开发版。最低 Obsidian 版本为 1.13.7，声明支持移动端（`isDesktopOnly: false`）。
- 提供每日时间记录、任务排期、预计与实际对比，以及周、月、年回顾；开发中的工作流还包括独立项目、后台执行状态与 MONO 界面。
- TypeScript 项目位于 `插件源码/lubi/`；插件入口 `src/main.ts`，分发目录 `.obsidian/plugins/lubi/`。仓库本身也可作为 Obsidian Vault 打开。

## 模块与数据

- `src/core/` 是纯逻辑；`src/services/` 负责 Vault 读写、网络、密钥和更新；`src/ui/` 负责界面；`src/styles/` 的分段 CSS 按顺序生成样式文件。
- 日记为 Markdown，只更新 `## 记录`；任务采用 schema v14。预计用时保存历史快照，自动生成的计划记录有待确认标识。
- 关键实现可从 `src/services/journal.ts`、`src/services/taskStore.ts`、`src/core/tasks.ts`、`src/ui/view.ts` 开始查阅；具体职责参见维护文档。

## 开发与注意事项

- Node.js >=22；在 `插件源码/lubi/` 下执行 `npm ci`、`npm run build`、`LUBI_REQUIRE_BROWSER=1 npm test`、`npm run check:dist`。测试分为 core、smoke、layout；浏览器测试不能以跳过当作通过。
- 当前工作树已有未提交的样式、版本说明和测试相关改动；继续工作前须重新查看 `git status`，不得覆盖。此轮仅作静态阅读，未运行测试，也未修改插件代码或个人数据。
- 不在真实 Vault 上未经授权做清空、迁移或写入；真实 Obsidian 和移动端表现仍需人工验收。
