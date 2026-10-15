# Lubi 开发约定

## 结构与数据

- TypeScript 源码、测试、样式和版本文件在 `插件源码/lubi/`；不要手改编译输出。源码分层：`src/core` 只放纯逻辑（lint 规则禁止引用 obsidian、Node 内置模块、services 和 ui），`src/services` 负责读写 Vault、网络、更新和钥匙串，`src/ui` 是界面。
- 本仓库也是可直接打开的 Vault，已有 `.obsidian/plugins/lubi/{main.js,manifest.json,styles.css}` 分发文件被跟踪；从源码构建后同步，不与源码目录的忽略生成物混淆。
- 日记是 Markdown，任务文件使用 schema v14；只改 `## 记录`，保留其他章节与未知字段。
- 预计用时保存历史快照，不按任务现值回填旧记录，也不把预计重复累加到实际统计。自动按计划生成的记录保留待确认标记。
- 数据清空、迁移、真实 Vault 写入和远程发布须由用户授权；先备份到仓库外。默认在测试 Vault / 隔离副本验证，不使用个人记录作夹具。

## 验证与版本

- 先看 git 状态与现有改动，不覆盖他人的未提交工作。
- 用锁文件安装（`npm ci`）。提交前在 `插件源码/lubi` 运行 `LUBI_REQUIRE_BROWSER=1 npm test`（core、smoke、layout 全量）和 `npm run check:dist`；不能将浏览器跳过当作通过。
- 生产包使用 minify + keepNames；可通过 `LUBI_TEST_PLUGIN` 指向实际 bundle 运行完整冒烟测试。
- 同步 manifest、package、package-lock 根版本和 versions.json；`npm run check:dist` 会核对版本对应关系，以及随 Vault 分发的三个文件与生产构建一致。
- 构建或模拟 UI 通过不等于真实 Obsidian / 移动端通过，报告未验证项，不擅自创建 Release / 标签。

## 样式与测试

- 样式源码在 `src/styles/` 的分段文件里，构建时按文件名顺序拼接成 `styles.css`（生成文件，不要直接改，也不要调换分段顺序或把规则挪到别的分段）。直接修改原有规则，不在末尾追加覆盖规则；焦点与选中状态统一用 `--focus-*` 变量（边框加粗加深，不加外圈）。
- 测试按类型放在 `test/core/`（纯逻辑）、`test/smoke/`（模拟 Obsidian 交互）、`test/layout/`（真实浏览器布局），公共代码放 `test/helpers/`；生成物与日志写到被忽略的 `test/.out/`。新增测试不用改 `package.json`。
- 布局测试用 `test/helpers/page.mjs` 的 `writePage` 写页面，页面必须声明 UTF-8（中文 Windows 上的 Chrome 会把未声明编码的页面按 GBK 解析）；浏览器路径统一用 `test/helpers/browser.mjs`，可用 `LUBI_BROWSER` 指定。

## Git 与隐私

- 不使用一揽子 git add；显式选择源码、测试、文档及上述分发文件。任务数据文件 `任务/任务数据.json` 不入库，插件首次写入时自动创建。
- 不提交个人日记、插件 data.json、工作区布局、助手会话、导出、私有备份、凭据、代理和具体本机路径。新 ignore 规则不自动撤销旧文件的跟踪，仍需检查暂存范围。
- 推送前确认远程 / 分支、git diff --cached --check、版本一致及秘密扫描；不强推。
- 本地 AI 设置仍可能含明文密钥；不要打印或复制到文档。网络功能和仍未修复的安全 / 数据限制必须如实说明。

## 文档

- README 面向安装与快速使用，教学手册解释操作，CHANGELOG 记录版本，docs/mcp-lubi-plugin.md 维护当前架构；历史计划在 docs/README.md 明确分类，不当作当前状态。
- 不把机器路径、单次测试日志或个人记录写进长期文档；截图只能用合成数据。

## AI 工具协作（CodeGraph / Caveman / Ponytail）

- 三者互补，不互相替代。MCP 是连接 AI 应用与外部工具的协议；只有当前会话实际提供 CodeGraph MCP 时才调用。不可用时用现有源码检索继续，不因本规则擅自安装服务、初始化索引或修改 MCP 配置。
- **CodeGraph：代码结构查询。** 遇到跨模块或不熟悉的结构问题，先查定义、调用链、影响范围和相关上下文；图谱用于导航，结论以当前源码和测试为准，索引状态或覆盖不确定时直接核对文件。
- **Caveman：调查与简报。** 不明 bug 先查复现、相关代码、日志或测试，再决定是否修改；简短报告须以证据为先，并区分已观察事实与推断。根因确认后优先做外科式小修；只有确有必要时才走安全重构流程。不得为追求简短省略安全警告或关键证据。
- **Ponytail Full：最小正确实现。** 理解问题后再按顺序检查：是否真的需要、能否复用现有实现、标准库或平台能力、已有依赖；然后提交最小且正确的 diff。避免无理由新增依赖、重复造轮子、预支未来需求或添加无必要抽象。
- **默认流程：** 结构问题先查 CodeGraph；不明 bug 先调查；实现时采用 Ponytail Full；最后按影响面做最小必要验证，同时遵守本文件已有的项目验证要求。
- **优先级：** 正确性、安全、数据安全、用户明确要求和无障碍基础都高于少写代码；不得以精简为由削弱错误处理、数据保护、可访问性或必要验证。
- **最终报告：** 简短说明改了什么及原因、实际验证及结果、未验证项或剩余风险；未运行的检查不得报告为通过。

参考：[Ponytail](https://github.com/DietrichGebert/ponytail) · [Caveman](https://github.com/JuliusBrussee/caveman) · [CodeGraph MCP 设置示例](https://github.com/shantham/codegraph/blob/main/docs/MCP-SERVER-SETUP.md) · [MCP](https://modelcontextprotocol.io/)
