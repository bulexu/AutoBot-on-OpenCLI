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

它们**不是**客户端源码。实际实现位于 `src/desktop/`，用原生 CSS 实现，不引用任何远程资源 —— 客户端 CSP 为 `default-src 'self'`，禁止 CDN 与远程字体。

## 设计稿与实现的差异

设计稿是视觉与交互的参考方向，实现以**真实功能**为准。落地时有意未实现以下设计稿中出现、但运行时并不支持的概念：

| 设计稿中的内容 | 实际情况 |
|---|---|
| 调度端口 `127.0.0.1:9410`、内存占用 `48.2 MB` | 无本地守护端口进程，无内存指标 |
| 本地 Python / Conda 运行时、Chromium 124 | 运行时是 OpenCLI（版本号真实显示），无 Python/Conda |
| `AES-256 Keyring`、`Keychain 2.1`、`校验和 sha256:...` | 凭证由 Electron `safeStorage` 加密到本机文件，无应用自建 keyring，无流程包校验和 |
| 「测试连接」按钮 | 无连接探测 IPC，未实现 |
| 实时日志流 | 运行库只保留元数据与分页结果，无日志 |
| 暂停 / 重试 / 删除流程、注销工作区 | 未实现 |
| 吞吐总量 `84,920 行`、成功率 `99.4%` | 看板统计由 `recentRuns()` 真实计算，范围为最近 30 条，界面上标注口径 |
| 今日 / 最近 7 天 / 最近 30 天时间筛选 | 仅支持最近 30 条 + 状态筛选 + 名称搜索 |
| 导出执行明细 CSV、分页 | 未实现 |
| 「流程设计」独立标签页 | 客户端里是「工作台」（对话式设计 + 试跑） |
| macOS 红黄绿交通灯按钮 | 用真实原生窗口，不自绘 |

设计系统本身（Inter + JetBrains Mono、12–13px 正文、圆角 4/6/10px、`#2563eb` 主色、`#f4f5f8` 画布）在实现中已完整保留。

## 重新获取

```
mcp__stitch__list_screens(projectId=1635135105039701169)
mcp__stitch__download_file(name=projects/1635135105039701169/screens/<screen-id>/fileEntries/html)
```
