# Lubi 前端页面检查（MCP 会话）

## 范围与方法

- 对象：`插件源码/lubi/preview/` 下的静态预览页（合成演示数据，无个人记录）。
- 方法：使用 Playwright（Chromium）以 1400×900 视口打开页面，截图并执行 DOM 检查。
- 截图输出在 `插件源码/lubi/preview/mcp-review/`，该目录被 `.gitignore` 忽略，不纳入提交。

## 结果

| 页面 | 截图 | 横向溢出 | 页面脚本错误 |
| --- | --- | --- | --- |
| review | 成功 | 无 | 无 |
| review-year | 成功 | 无 | 无 |
| tasks-daily-gantt | 成功 | 无 | 无 |
| planning-calendar-week | 成功 | 无 | 无 |
| planning-gantt-week | 成功 | 无 | 无 |
| planning-list-week | 成功 | 无 | 无 |
| settings | 成功 | 无 | 无 |
| modal-task | 成功 | 无 | 无 |
| async-workflow | 成功 | 无 | 无 |
| dark/review | 成功 | 无 | 无 |

`empty`、`projects-gantt` 位于 `preview/dark/` 下，不在顶层，本轮未截图。

## DOM 检查

- 无可访问名称的按钮：0（全部页面）。
- 缺少 `alt` 的图片：0（全部页面）。
- 字号小于 11px 的可见文本：0（全部页面）。
- 被截断的可见文本：未发现。自动检查命中的文本均带有 `lubi-sr-only` 类，属于仅供读屏软件使用、视觉上隐藏的文本，不是显示问题。

## 结论与未验证项

- 自动检查未发现明确的页面问题。
- 本轮只做了静态预览页检查，未覆盖真实 Obsidian 环境、移动端和交互状态（如悬停、弹窗的各种输入）。
- 视觉细节（间距、对齐、配色）需人工复核上述截图。

## 修复记录

- 待处理卡片（`.lubi-attention-card`）：边框由黑色改为浅灰色（`--color-border`），与其他卡片统一。截图与计算样式已核对。
- 设置页下拉框（`.lubi-settings select`）：高度 30px，圆角 6px，与相邻输入框对齐。
- 构建与测试：`npm run build`、`test:core`、`settings-layout`、`async-workflow-layout` 均通过（布局测试要求真实浏览器）。
- 保持不变的设计：灰阶配色、已跳过卡片的删除线、甘特图横向滚动（属于滚动区域的正常裁切）。
- 未同步：`.obsidian/plugins/lubi/` 下的分发文件未更新。同步会写入真实 Vault，需用户授权。
