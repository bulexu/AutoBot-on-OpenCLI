---
name: autobot-flow-designer
description: 从业务描述、cURL、脱敏 API 响应和飞书多维表字段设计 Autobot 声明式 API 流程，校验并打包可导入的 .flow。适用于 HTTP 采集、分页、多表关联、汇总和批量 Upsert。
---

# Autobot API Flow 设计

用本地 AI 工具完成设计。需要一个本地 Autobot 源码目录及 Node.js 24+，由 Autobot 自己的校验器和打包器生成交付文件。如果当前目录没有 Autobot，定位用户的源码目录。在源码目录缺少依赖时按仓库说明执行 `npm ci`。

## 收集需求

根据用户已给的材料追问真正缺失的信息。确认读取哪些接口和表、输入参数、字段映射、唯一键、缺数处理、汇总口径以及预期输出。HTTP 需要已确认的方法、地址和脱敏响应样例，使用 POST 读取时需确认其只读语义。分页需确认策略、字段路径和停止条件。飞书目标需要确认字段类型和用来查找已有记录的业务键，实际更新由运行时使用飞书 `record_id`。

使用 `{{secret.凭证名}}` 形式的请求头引用（凭证名使用英数字、下划线或连字符），在客户端绑定凭证。设计资料使用脱敏样例，交付文件中的 URL、请求体和默认参数也只保留必要的非机密数据。

## 编写和验证

1. 在 Autobot 源码中查看 `src/design/workflow-proposal.ts` 的 `workflowInstructions`，并用 `src/flow/workflow.ts` 和 `src/flow/inputs.ts` 核对当前版本的字段和算子。多表读取、逐项 HTTP、限流、缺数及聚合的完整示例在 `examples/competitor-sales-declarative.ts`。示例中的业务标识只用于理解结构。
2. 编写一个 JSON 文件，顶层为 `{"manifest": {...}, "workflow": {"steps": [...]}}`。Manifest 包含 `id`、`version`、`schemaVersion: 1`、`endpoints` 和可选的 `inputs`。端点使用实际请求的 method、origin、path。运行时参数从 `manifest.inputs` 声明，再由步骤引用。编辑已有流程时沿用其 ID 并更新版本。
3. 用通用算子组合业务规则。HTTP 采集用 `http.read`，飞书读写用 `bitable.read` 和 `bitable.upsert`，转换用 `records.map` 或 `records.transform`。每步用唯一 ID，只引用前序输出。需要逐项关联请求时可用 HTTP exchange 模式。复杂计算放在 JSONata 表达式中，返回 `{records, warnings?}`。汇总和写入键明确处理缺值、零值及重复记录。
4. 从 Autobot 根目录运行 `node scripts/pack-flow.mjs /路径/definition.json /路径/result.flow`。根据校验错误修订 JSON，打包器会重新导入生成物验证兼容性，输出路径须为新文件。打包通过后，按样例检查输入到输出的业务值。条件具备时在客户端只读预览，确认每个目标表的字段、写入键及结果。交付 JSON 源文件和 `.flow`，说明已通过哪些验证。
5. 当前技能覆盖 API Flow。浏览器 RPA 的可执行包与试跑仍属 P3，涉及 RPA 时按现有支持范围给出操作草案。
