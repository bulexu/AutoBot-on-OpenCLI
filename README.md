# AutoBot-on-OpenCLI

Autobot 是一个本地桌面工作流工具。用本地 AI 工具或编辑器设计 Flow，在 Autobot 中导入、绑定凭证、预览、执行和查看记录。当前支持 HTTP 数据采集、飞书多维表读写，以及通过 OpenCLI 打开浏览器页面并读取标题。

- [人类使用手册](#人类使用手册) · 启动客户端、设计、导入和执行流程。
- [AI 协作手册](#ai-协作手册) · 获取需求、编写声明式流程、验证和交付。
- [开发手册](#开发手册) · 本地开发、项目结构和 Windows 打包。

## 人类使用手册

### 启动客户端

已有安装包时直接打开 Autobot。从源码运行需要 Node.js 24 或更新版本，在项目根目录执行：

```sh
npm ci
npm run desktop
```

客户端使用随项目提供的 OpenCLI。API 流程需要内置 OpenCLI 可用。浏览器流程还需要 Chrome 或 Chromium 中的 OpenCLI Browser Bridge 扩展已连接。在「系统设置 → 运行环境」点击「重新检查」，查看守护进程版本、扩展兼容性和连通性。 [OpenCLI 浏览器扩展说明](https://github.com/jackwener/OpenCLI#2-install-the-browser-bridge-extension)

### 设计流程

1. 把 [autobot-flow-designer](skills/autobot-flow-designer/) 整个目录复制到支持 Agent Skills 的本地 AI 工具中。Codex 可放在项目的 `.agents/skills/` 下。重新加载工具，并让它访问此 Autobot 源码目录和已安装的项目依赖。
2. 在 Codex 中调用 `$autobot-flow-designer`。说明数据从哪里来、如何处理、写到哪里，并提供脱敏 cURL、响应样例、目标表字段和用于匹配旧记录的业务键。凭证在 Autobot 里填写。
3. AI 交付可编辑的 JSON 定义和可导入的 `.flow`。手工设计时也使用同一份 JSON 格式和打包命令，见下文。当前技能面向 API 场景。试用浏览器流程时，可从 RPA 样例的 JSON 开始。

### 导入和执行

1. 在「工作流管理」导入 `.flow`。可先选下面的样例。
2. 在「凭证」填写流程所需的本机凭证。若流程要求绑定目标表，再填写 Base 和表 ID。凭证加密存放在本机。
3. 在「概览」填写并保存动态参数。点击眼睛图标执行「只读预览」，核对拟写入记录、告警或页面读取结果。
4. 点击「正式执行」。在「执行看板」或「执行历史」打开详情，查看步骤和异常。设置 Cron 后，定时任务使用本机时区和已保存的参数，执行时需保持客户端运行。

| 样例 | 流程包 | 设计资料 |
| --- | --- | --- |
| Amazon 竞品月销量 | [导入包](examples/competitor-sales-declarative.flow) | [流程说明](docs/competitor-sales-flow.md) |
| Shopee 竞品月销量 | [导入包](examples/shopee-monthly-sales.flow) | [流程说明](docs/shopee-sales-flow.md) · [JSON 定义](examples/shopee-monthly-sales.json) |
| RPA 打开网页并读取标题 | [导入包](examples/browser-page-title.flow) | [JSON 定义](examples/browser-page-title.json)。预期标题为 `Example Domain`。 |

如果新包导入时出现 `Unsupported operator`，完全退出旧客户端，从当前源码重新运行 `npm run desktop` 后再导入。

## AI 协作手册

1. 读取 [设计技能](skills/autobot-flow-designer/SKILL.md)，根据现有资料确认输入、读取范围、业务规则、输出字段和验收样例。接口分页、缺数处理和写入键以响应样例及用户口径为依据。凭证使用 `{{secret.凭证名}}` 引用。
2. 输出顶层为 `{ "manifest": { ... }, "workflow": { "steps": [...] } }` 的 JSON。Manifest 声明 `id`、`version`、`schemaVersion`、`endpoints` 和可选的 `inputs`。流程升级沿用 ID 并更新版本。步骤按声明顺序运行，引用前序输出。
3. 业务规则写在 Flow 内。HTTP 使用 `http.read`，按实际接口配置游标、页码或偏移量。飞书使用 `bitable.read` 和 `bitable.upsert`，通过业务键匹配已有记录，再按飞书返回的 `record_id` 更新。转换使用 `records.map` 或 `records.transform`，复杂计算使用 JSONata。浏览器当前可用 `browser.open` 和 `browser.title`，在 manifest 声明对应的 HTTPS 端点。字段定义和允许值以 [流程校验器](src/flow/workflow.ts) 与 [输入定义](src/flow/inputs.ts) 为准。
4. 在项目根目录运行下列命令。输出路径须为尚不存在的 `.flow` 文件，打包器会重新导入成品校验。用样例核对业务结果，条件具备时在客户端做只读预览。交付 JSON、流程包和验证结果。

```sh
node scripts/pack-flow.mjs path/to/definition.json path/to/output.flow
```

## 开发手册

```sh
npm ci
npm run desktop
npm run check
```

`npm run check` 执行格式检查、Lint、TypeScript 检查、渲染端构建和测试。可单独运行 `npm test`。改动主进程、预加载脚本或流程执行器后，完全退出客户端再启动，确保加载新代码。

| 路径 | 职责 |
| --- | --- |
| [src/desktop/](src/desktop/) | Electron 主进程、IPC 和 Vue 界面 |
| [src/flow/](src/flow/) | 流程声明校验、参数解析、JSONata 和流程包编解码 |
| [src/runtime/](src/runtime/) | 步骤执行、分页、OpenCLI 调用和服务绑定 |
| [src/integrations/](src/integrations/) | HTTP、飞书多维表和 OpenCLI 对接 |
| [src/storage/](src/storage/) | SQLite 运行记录和步骤结果 |
| [examples/](examples/) · [test/](test/) | 可导入样例及自动化验证 |

扩展运行时算子时，同步核对定义校验、执行、凭证绑定及结果展示。可用既有 API 样例验证只读预览和重复写入，用浏览器标题样例验证 RPA。架构与阶段计划见 [项目设计](docs/base.md)。

在 Windows 打包环境执行 `npm run package:win`，生成 x64 NSIS 安装包，产物位于 `dist/`。
