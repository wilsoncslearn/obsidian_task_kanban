# Lubi 样式分段

构建时（`npm run build`、`npm run dev`、测试构建）把本目录的 `.css` 文件按文件名顺序**逐字节拼接**成插件根目录的 `styles.css`。`styles.css` 是生成文件，已被 Git 忽略，不要直接修改。

- 分段按原文件的先后顺序切开，后面的规则可以覆盖前面同等优先级的规则，所以**不要调换文件顺序**，也不要把规则挪到别的分段。
- 改样式时直接修改原有规则，不在文件末尾追加覆盖；焦点与选中状态统一使用 `--focus-*` 变量。
- 新增分段文件后，正在运行的 `npm run dev` / `npm run dev:vault` 需要重启才会监听它。
- 调整样式结构（拆分、去重）时，用计算样式快照证明没有视觉变化：先 `npm run test:build && node test/helpers/preview.mjs`，把当前 `styles.css` 复制一份，运行 `node scripts/style-snapshot.mjs test/.out/before.json`；改完后重新构建，运行 `node scripts/style-snapshot.mjs test/.out/after.json --swap-css <旧 styles.css> styles.css`，再用 `--compare 前 后 --ignore lubi-gantt-today` 比较两份快照（甘特图的“当前时刻”线随时间变化，需要排除）。

| 文件 | 内容 |
| --- | --- |
| `00-tokens.css` | 插件内的变量与 Obsidian 兼容别名、MONO 黑白 tokens |
| `01-base.css` | 基础与产品摘要 |
| `02-topbar-daily.css` | 顶栏、每日页 |
| `03-tasks.css` | 任务列表、任务页布局 |
| `04-review.css` | 回顾 |
| `05-modals.css` | 弹窗 |
| `06-settings.css` | 设置 |
| `07-panel-fit.css` | 2026-09 的面板内适配、可达性与数据提示 |
| `08-v1.4-design.css` | v1.4 设计层：顶栏三段式、时间轴、回顾、任务、弹窗、窄面板 |
| `09-v1.5-planning.css` | v1.5 计划层、待确认记录、设置与分类、悬停 |
| `10-views.css` | 历史名称、甘特图、日甘特、统一计划视图、日历·日、JSON 导入、任务表单 |
| `11-async.css` | 异步工作 |
| `12-mono.css` | MONO 接入：层级、命名控件、窄面板容器查询 |
| `13-light-task.css` | 轻表单 |
| `14-display-fixes.css` | 显示修复：未定时标签、单行任务行、计划页头部、日历·日 |
