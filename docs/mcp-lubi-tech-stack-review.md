# Lubi 技术栈与目录结构评审（2026-10-15）

## 范围与方法

- 对象：`插件源码/lubi/` 的源码、构建与测试配置，以及仓库根目录结构。
- 基线：`main` 最新标签 1.7.1，加上未提交的 1.8.0 工作区（快照时 `git status` 共 130 条改动 / 未跟踪条目）。
- 方法：只读。读取配置与源码，查看 git 状态，做静态统计（行数、字节、grep 计数）。未运行 build / test，未修改源码；数字会随开发变化。

## 结论

**技术栈：合适，不建议更换。** TypeScript（strict）+ esbuild + Obsidian API + 原生 DOM，与官方 sample plugin 路线一致。运行时零依赖，开发依赖 6 个；源码中没有 `innerHTML`，网络请求走 `requestUrl`，桌面专属能力有平台判断保护。需要补的是工程化短板：依赖版本声明、密钥存储、生成物管理、测试编排、lint / CI。

**目录结构：源码内部基本清晰，外围偏乱。** `src/core` / `src/ui` 分层，依赖方向干净（core 不引用 ui），文件名基本对应功能。主要问题有四个：仓库根目录同时承担个人 Vault、插件开发和 AI 工具三种职责；`test/` 平铺并混入生成物与日志；少数超大文件（`src/ui/modals.ts`、`styles.css`）；`core` 中纯逻辑与 I/O 混放。

## 技术栈现状

| 层面 | 现状（快照） | 评价 |
| --- | --- | --- |
| 语言 | TypeScript 5.9，`strict: true` | 合适 |
| 构建 | esbuild 0.24 打包为 CJS 单文件，生产包 minify + keepNames，约 320 KB | 合适，与官方模板一致 |
| 平台 API | Obsidian 类型 1.13.1（`package.json` 写 `latest`），manifest 声明最低 1.4.0 | 需固定版本，见 P1-3 |
| UI | 原生 DOM：`createDiv` 364 处、`createEl` 180 处，`innerHTML` 0 处，无框架 | 合适 |
| 样式 | 单个 `styles.css`：1901 行 / 164 KB，`var(--` 1717 处，`.lubi-*` 类名 455 个，`!important` 15 处 | 方向对，体量偏大，见 P2-1 |
| 网络 | `requestUrl`；AI 请求失败后改用系统 curl 子进程重试（仅桌面） | 两套网络路径，见 P1-5 |
| 桌面专属 | 一键更新仅在 `Platform.isDesktopApp` 且为 `FileSystemAdapter` 时延迟加载 `node:fs` 等模块 | 合适 |
| 数据 | 日记为 Markdown 行内字段；任务为 JSON（schema v14，写队列、备份、磁盘比对） | 合适，人可读，随 Vault 同步 |
| 测试 | 33 个 Node 测试脚本（多数用 `node:assert`）；jsdom 模拟 DOM；无头 Chrome / Edge `--dump-dom` 做布局检查；截图另用 Python Playwright | 覆盖强，编排弱，见 P2-3 |
| 依赖 | 运行时 0 个；开发 6 个（typescript、esbuild、obsidian、@types/node、jsdom、lucide-static） | 合适（lucide-static 只被测试 mock 使用） |
| 工程化 | 无 CI、无 lint / 格式化、无 `engines`、无 `.gitattributes` | 需补，见 P2-4、P2-5 |

### 为什么不建议换框架或构建工具

- 官方 sample plugin 用的就是 TypeScript + esbuild，换成 Vite / Rollup 收益很小。
- React / Svelte 等框架会引入运行时和另一套渲染模型。现有冒烟与布局测试大量断言 DOM 结构，迁移成本高，而且 1.8.0 还有大量未提交工作。
- 原生 DOM 配合 Obsidian CSS 变量，最容易跟随用户主题；`innerHTML` 为 0 也减少了注入风险。
- 现在的维护痛点（大文件、测试编排）换框架也解决不了，要靠拆文件和整理目录。

## 需要改进的地方

### P1：正确性、安全与可复现

1. **1.8.0 的新文件尚未跟踪。** `src/` 下有 7 个新文件（如 `src/core/productService.ts`、`src/ui/productivity.ts`），`test/` 下有 13 个新测试，都处于未跟踪状态；而 `src/main.ts` 已经引用它们，`package.json` 的测试脚本也已调用它们。如果只提交已跟踪文件，得到的提交无法构建。提交 1.8.0 时需显式加入；CI 从干净检出构建，可以兜住这类遗漏（见 P2-4）。
2. **AI Key 明文保存在插件 `data.json`。** Obsidian 1.11.4 起提供 `SecretStorage` 与 `SecretComponent`（[Secret Storage 指南](https://docs.obsidian.md/plugins/guides/secret-storage)）。建议迁移，让 Key 不再随 `data.json` 同步或备份：旧版客户端用 `requireApiVersion` 判断后沿用现有方式，或者把最低版本提高到 1.11.4。它不保证一定由系统钥匙串加密，移动端支持情况也需按官方文档核对，文档中要如实描述。
3. **类型版本与最低版本不一致。** `obsidian` 依赖写成 `latest`（锁文件为 1.13.1），manifest 却声明 1.4.0，类型检查发现不了误用 1.4.0 之后才有的 API。按若干新版 API 名称抽查，只命中 `requireApiVersion`（2 处）和 `revealLeaf`，未见明显越界，但目前靠人工保证。建议固定 `obsidian` 的精确版本，并把 `minAppVersion` 声明为实际验证过的最低客户端版本。
4. **生成物入库或手工同步，容易漂移。**
   - `scripts/lubi-core.mjs` 是 esbuild 产物（首行为 `// src/core/time.ts`），被 `scripts/migrate-vault.mjs` 引用。它最后提交于 2026-09-26，而 `src/core/tasks.ts` 之后仍有提交和未提交修改。建议改为由 npm 脚本现场生成，不再入库。
   - 分发目录 `.obsidian/plugins/lubi/` 靠手工复制并核对哈希。快照时插件源码目录下的 `main.js`（319,659 B）与分发目录中的 `main.js`（318,853 B）大小不同。建议增加一个需要显式运行的同步脚本：生产构建，复制三份文件，输出 SHA-256。
5. **AI 请求有两套网络路径。** `src/ui/aiTask.ts`、`src/ui/settingsTab.ts` 先用 `requestUrl`，失败后用 `src/core/curl.ts` 启动系统 curl 重试。
   - 文档与代码不一致：代码中 curl 会校验 TLS（没有 `-k` / `--insecure`），但 [维护与构建](mcp-lubi-plugin.md) 的“发布与隐私”一节仍写“curl 兜底跳过证书校验”，应更新。
   - 确认兜底是否仍需要：`requestUrl` 本身不受 CORS 限制。如需保留，可以改为在设置中显式开启。
   - 统一 Node 模块加载方式：`curl.ts` 用 `(0, eval)('require')`，`pluginInstaller.ts` 直接用 `require`。

### P2：可维护性与结构

1. **超大文件。**

   | 文件 | 规模 | 说明 |
   | --- | --- | --- |
   | `src/ui/modals.ts` | 1190 行 / 70 KB | 5 个弹窗类，`TaskModal` 约 600 行，`RecordModal` 约 395 行 |
   | `src/ui/tasks.ts` | 744 行 | 计划页渲染，15 个顶层函数 |
   | `src/core/tasks.ts` | 736 行 | 任务存储、迁移与写队列 |
   | `src/ui/calendarDay.ts` | 667 行 | `renderCalendarDay` 一个函数约 557 行 |
   | `styles.css` | 1901 行 / 164 KB | 所有界面的样式集中在一个文件 |

   建议改到哪拆到哪，不做一次性重构：弹窗按类拆到 `src/ui/modals/`；样式拆成多个分文件，由 esbuild 合并输出为单个 `styles.css`（Obsidian 只读取这一个文件）。

2. **`core` 同时放纯逻辑和 I/O。** 18 个 core 文件中有 6 个引用 `obsidian`（`journal`、`tasks`、`migrate`、`productService`、`pluginUpdate`、`pluginInstaller`），`curl.ts` 还会启动子进程，核心测试因此要把 `obsidian` 别名到 stub。建议逐步分成两类目录：不引用 obsidian / Node 的纯领域逻辑，以及存储、网络、更新等服务。至少加一个检查，约定纯逻辑文件不得引用 `obsidian`。

3. **`test/` 平铺且混杂。** 目录内有 88 个文件：39 个 `.mjs`（33 个测试，其余为夹具、预览生成等辅助脚本和核心测试产物）、37 个 `.log`、4 个 `.py`、3 个生成的 `.cjs`、2 个 mock、2 个入口 `.ts`。`package.json` 用 `&&` 把 33 个测试和 3 次 esbuild 串成 36 步：新增测试必须改脚本，第一处失败就中断，也没有汇总。
   - 按 `test/core`、`test/smoke`、`test/layout`、`test/helpers` 分目录。
   - 产物和日志输出到一个被忽略的目录。
   - 改用 Node 内置的 `node --test` 按目录运行，不新增依赖。它按文件退出码判定结果，现有脚本可以逐步迁移；共享产物的测试必要时串行运行。

4. **缺少 lint 与 CI。** 官方 ESLint 插件 [`eslint-plugin-obsidianmd`](https://github.com/obsidianmd/eslint-plugin) 把插件指南写成了规则，社区目录的自动审核也用它；官方 sample plugin 自带对应配置和 CI 示例。建议加入 lint，再加一个最小 CI：`npm ci`、`npm run build`、`test:core`、`test:smoke`。布局测试需要浏览器，可以放在装有 Chrome 的 runner 上，或继续本地执行。

5. **小修。**
   - `.gitignore` 补 `*.log`、`__pycache__/`、`test/product-plugin.cjs`（目前 37 个日志和这些产物都显示为未跟踪）。
   - 增加 `.gitattributes` 固定 LF：快照时 git 已提示 `任务/任务数据.json` 将被转换为 CRLF。
   - `package.json` 增加 `engines` 字段。
   - `tsconfig.json` 的 `moduleResolution` 可改为与 esbuild 一致的 `bundler`。
   - `tsconfig.json` 的 `types: ["node"]` 让全部源码都能看到 Node 全局，移动端不可用的 API 不会被类型检查拦住。抽查 `src/`，除 `pluginInstaller.ts`、`curl.ts` 外没有 Node 全局用法，这一项属于预防，可以用一个扫描测试守住。

### P3：可选

1. **中文目录名“插件源码”。** 对 Obsidian 用户很直观，但给工具链带来摩擦：git 默认把路径转义为八进制，文档链接需要 URL 编码，部分 Windows 终端有代码页问题。如果要改成 ASCII（例如 `plugin/`），建议在 1.8.0 提交后一次完成，并同步 AGENTS.md 和 docs。Vault 内容目录（日记、任务、附件）保持中文没有问题。
2. **两套浏览器工具。** 布局检查用 Node + 系统 Chrome，截图用 Python Playwright（`test/shot.py`、`scripts/screenshots.py`）。可以评估统一到 Node，去掉 Python 依赖；非必须。

## 目录结构评价

### 仓库根目录

```text
仓库根（同时是 Obsidian Vault）
├─ 日记/ 任务/ 附件/ 备份/ .obsidian/    Vault 内容与配置（日记、备份已忽略）
├─ 插件源码/lubi/                      插件开发
├─ docs/ README.md CHANGELOG.md AGENTS.md CONTEXT.md Lubi 教学手册.md
└─ .agents/（已跟踪） .claudian/ .snapshots/（已忽略）    AI 工具
```

- 好处：插件在自己的 Vault 中边开发边使用，分发文件随 Vault 提供。
- 问题：
  - 个人数据与源码共处一库，安全全靠 `.gitignore` 和“不一揽子 add”的纪律。`任务/任务数据.json` 被跟踪，约定为空模板，但快照时工作区有 678 行新增改动，一旦误提交就会带出个人任务。
  - 新的忽略规则不会自动取消已有跟踪：`.snapshots/config.json` 和 `.obsidian/workspace.json` 都在忽略规则内，却仍被跟踪，后者当前也有改动。
  - `.agents/skills/computer-use/`（7 个 `.ps1`、5 个 `.cs`）与插件产品无关，却随插件仓库提交。
- 建议：
  - 短期：把任务模板放进插件源码（如 `插件源码/lubi/templates/`），真实任务文件取消跟踪并加入忽略；`.snapshots/config.json`、`.obsidian/workspace.json` 同样取消跟踪（`git rm --cached` 需你确认后执行）。`.agents/` 是否留在仓库由你决定。
  - 长期可选：拆成插件源码仓库和个人 Vault 两个仓库，Vault 只放安装产物。

### 插件源码目录

```text
插件源码/lubi/
├─ src/        main.ts、settings.ts，core/（18 个文件），ui/（26 个文件）
├─ test/       88 个文件平铺（测试、夹具、mock、产物、日志、Python 截图脚本）
├─ scripts/    lubi-core.mjs（生成物）、migrate-vault.mjs、screenshots.py
├─ preview/    上百个预览 HTML、截图与日志（已忽略）
├─ .codegraph/ 代码图谱数据库（已忽略）
└─ main.js（生成物，已忽略）、styles.css、manifest.json、versions.json 等
```

- 清晰的部分：`src` 按 core / ui 分层，依赖方向单一；文件名基本对应功能；[维护与构建](mcp-lubi-plugin.md) 里的模块职责表可以当导航用。
- 不够直观的部分：
  - `ui/` 的 26 个文件平铺，页面、弹窗、通用组件、设置混在一起。
  - `core` 混放纯逻辑和 I/O。
  - `test/` 与 `preview/` 堆积产物和日志，真正的源文件不易找到。

建议的目标结构如下，随功能迭代逐步迁移，不一次性重排：

```text
插件源码/lubi/
├─ src/
│  ├─ main.ts、settings.ts
│  ├─ domain/        纯逻辑：time、records、metrics、gantt、planning、quickparse 等
│  ├─ services/      存储与外部交互：journal、tasks、migrate、pluginUpdate、pluginInstaller、curl 等
│  ├─ ui/
│  │  ├─ views/      view、tasks、calendarDay、review、gantt 等页面
│  │  ├─ modals/     每个弹窗一个文件
│  │  ├─ components/ components、tooltips、drag、modelPicker、nameSuggestions 等
│  │  └─ settings/   settingsTab、pluginUpdateSettings
│  └─ styles/        样式分文件，构建时合并为 styles.css
├─ test/             core/、smoke/、layout/、helpers/
├─ scripts/          只放手写脚本
└─ .artifacts/       构建产物、测试 bundle、日志、预览与截图（忽略）
```

## 建议推进顺序

1. 提交 1.8.0 前：显式加入 20 个新文件；确认 `任务/任务数据.json` 不含个人数据；补 `.gitignore`。
2. 1.8.0 发布后：
   - 固定 `obsidian` 版本并核对 `minAppVersion`。
   - Key 迁移到 SecretStorage。
   - `lubi-core.mjs` 改为生成，并增加分发同步脚本。
   - 修正文档中关于 curl 的描述。
3. 后续随功能迭代：拆 `modals.ts` 和 `styles.css`；`test/` 分目录并改用 `node --test`；`core` 分层；加 lint 与 CI。
4. 可选：目录改 ASCII 名、拆分仓库、统一截图工具。

## 未验证项

- 只做了静态分析：未运行 build / test，未在真实 Obsidian 或移动端检查。
- 统计数字（行数、字节、文件数）来自 2026-10-15 的工作区快照，包含未提交改动。
- 未评估运行性能，也未评估真实数据规模下的读写表现。
- 以上建议均未实施；取消跟踪、目录改名、拆分仓库等操作需要你确认。
