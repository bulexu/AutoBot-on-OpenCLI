# AutoBot-on-OpenCLI

### 在本地 AI 工具中设计 Flow

把 [autobot-flow-designer](skills/autobot-flow-designer/) 整个目录复制到 AI 工具的 Skills 目录。Codex 和支持 Agent Skills 的工具可按各自的技能目录约定安装，例如项目内的 `.agents/skills/`（Codex）。重新加载工具后，调用 `$autobot-flow-designer`，提供业务目标、脱敏接口样例及目标字段。技能需要能访问当前 Autobot 源码目录，使用 Node.js 24+ 和仓库依赖完成校验与打包。
