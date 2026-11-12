# Stitch 设计稿存档

Stitch 项目 **Autobot 桌面客户端 · 任务执行看板与工作流管理**（projectId `1635135105039701169`）导出的原始 HTML 设计稿。

在线版本：https://stitch.withgoogle.com — 项目为 PRIVATE，需要授权账号访问。

## 文件清单

| 文件 | Stitch 屏幕标题 | 对应客户端页面 |
|---|---|---|
| `01-dashboard.html` | Autobot 执行看板 - 简约风格 | 执行看板 |
| `02-workflow-list.html` | Autobot 工作流管理 - 列表与概览 | 工作流管理 · 概览 |
| `03-credentials.html` | Autobot 工作流管理 - 凭证配置 (简约风格) | 工作流管理 · 凭证 |
| `04-workbench.html` | Autobot 工作台 - 流程设计 (简约风格) | 工作台 |
| `05-settings.html` | Autobot 系统设置 - 简约风格 | 系统设置 |
| `06-run-detail.html` | Autobot 执行详情 - 未完成与失败异常 | 执行详情 |

## 这些文件是什么

Stitch 生成的设计稿（Tailwind CDN + Google Fonts + Material Symbols），可直接用浏览器打开预览。

它们**不是**客户端源码。实际实现位于 `src/desktop/renderer/`，用 Vue 3 + Tailwind CSS v4 实现，不引用任何远程资源 —— 客户端 CSP 为 `default-src 'self'`，禁止 CDN 与远程字体。

## 组件来源

界面统一使用两套开源组件库，代码通过 registry 拉取后随仓库一起提交（`src/desktop/renderer/components/`）：

| 目录 | 来源 | 用途 |
| --- | --- | --- |
| `components/ui/` | [shadcn-vue](https://www.shadcn-vue.com/) | 按钮、表格、对话框、表单、标签页等通用控件 |
| `components/ai-elements/` | [AI Elements Vue](https://ai-elements-vue.com/) | 对话区、消息、输入框、建议气泡等 AI 界面组件 |

`scripts/vendor-registry.mjs` 负责拉取并写入这些文件，`npm run vendor:registry` 可重新生成。AI Elements 的 Markdown 渲染链路（KaTeX、Shiki、Mermaid）没有引入：设计 Agent 的回复是纯文本（`src/design/model.ts` 中的 `reply: z.string()`），该链路只会带来约 2 MB 的无用体积。

## 设计稿与实现的差异

设计稿是视觉与交互的参考方向，实现以**真实功能**为准。落地时有意未实现以下设计稿中出现、但运行时并不支持的概念：

| 设计稿中的内容 | 实际情况 |
|---|---|
| 调度端口 `127.0.0.1:9410`、内存占用 `48.2 MB` | 无本地守护端口进程，无内存指标 |
| 本地 Python / Conda 运行时、Chromium 124 | 运行时是 OpenCLI（版本号真实显示），无 Python/Conda |
| `AES-256 Keyring`、`Keychain 2.1`、`校验和 sha256:...` | 凭证由 Electron `safeStorage` 加密到本机文件，无应用自建 keyring，无流程包校验和 |
| 「测试连接」按钮 | 无连接探测 IPC，未实现 |
| 实时日志流 | 运行库只保留元数据、分页结果与步骤记录，无日志流 |
| 故障堆栈 `RETURN_CODE / BUFFER_ROWS / RAM_PEAK / target_dsn` | 运行时没有采集这些指标，界面不展示 |
| 「重试执行」「导出故障诊断日志」「前往检查工作流配置」按钮 | 未实现，只有诊断结论与处理建议 |
| 步骤耗时 `240ms / 18,420ms` | 真实耗时由 `run_steps.duration_ms` 记录，逐步骤执行后写入 |
| 「上游读取 1,280 条已暂存内存，未提交任何数据」等影响分析 | 无事务与回滚信息，界面不展示 |
| 暂停 / 重试 / 删除流程、注销工作区 | 未实现 |
| 吞吐总量 `84,920 行`、成功率 `99.4%` | 看板统计由 `recentRuns()` 真实计算，范围为最近 30 条，界面上标注口径 |
| 今日 / 最近 7 天 / 最近 30 天时间筛选 | 仅支持最近 30 条 + 状态筛选 + 名称搜索 |
| 导出执行明细 CSV、分页 | 未实现 |
| 「流程设计」独立标签页 | 客户端里是「工作台」（对话式设计 + 试跑） |
| macOS 红黄绿交通灯按钮 | 用真实原生窗口，不自绘 |

设计系统本身（Inter + JetBrains Mono、12–13px 正文、圆角 4/6/10px、`#2563eb` 主色、`#f4f5f8` 画布）在实现中已完整保留 —— 配色以 Tailwind v4 的主题变量写在 `src/desktop/renderer/styles/main.css`，同时映射到 shadcn-vue 的语义色（`--background`、`--primary`、`--border` 等），使组件库和手写界面读同一份色板。

## 执行详情（`06-run-detail.html`）的落地方式

设计稿的右侧抽屉被实现为客户端的「执行记录详情」弹窗，保留了「失败诊断卡片 + 管道执行路径」的结构：

| 设计稿元素 | 实现 |
|---|---|
| 未完成诊断分析 | 错误码徽章 + 原始错误消息 + 处理建议，来自 `runs.failure_code / failure_message` |
| 管道执行路径 | 逐步骤的真实记录（状态、产出条数、耗时），来自 `run_steps` 表 |
| 步骤 3/3 [生产表事务提交] 失败 | 「在此中断」标记在真正失败的那一步上 |

诊断信息全部来自运行时真实记录：`src/runtime/failure.ts` 把错误分类为稳定错误码，`src/runtime/execute.ts` 给每一步打上 `stepId` 并汇报产出，OpenCLI 工作进程把原因写回运行库，主进程再读出来交给界面。升级前产生的历史记录没有这些字段，界面显示「无步骤记录」而不是编造原因。

## 重新获取

```
mcp__stitch__list_screens(projectId=1635135105039701169)
mcp__stitch__download_file(name=projects/1635135105039701169/screens/<screen-id>/fileEntries/html)
```
