import { flowExpression } from '../flow/expression.ts';
import { endpoint, validateFlow } from '../flow/workflow.ts';
import type { parseCurl } from './source.ts';

export const workflowInstructions = [
  '复杂流程请用 workflowJson 返回 JSON 字符串，内容为 { "inputs": [...], "steps": [...] }，简单流程可用原有映射字段。',
  'inputs 项为 {key,label,type,required?,default?,min?,max?}，支持 month、number、string、boolean。',
  '每步有唯一 id 和 op。bitable.read 使用 baseToken、table，输出 fields 对象数组。',
  'records.transform 用 sources（前序步骤 ID 数组）和 expression（JSONata 表达式），输入为 {inputs,mode,sources}，输出 {records:[...],warnings?:[...]}。',
  'JSONata 用 ( $v := expression; result ) 组织多语句，字段名用反引号，禁止 JavaScript 的 const、return、?.、=> 或对象解构。数组的映射可用 $map(array,function($row){ expression })。',
  '可运行的转换示例：( $month := inputs.month; {"records": [sources.source.({"月份": $month, "销量": units})]} )。可运行的组合键示例：$string([`月份`, `产品名`])。',
  'JSONata 用 $not($exists(x)) 判断未提供，动态字段用 $lookup，使用路径投影展开数组；$parseJSON 解析 JSON 字符串。步骤 ID 有连字符时用反引号引用。',
  'http.read 使用 url、method、readOnly、body、recordsPath，可用 from 与 bind.body 将前序记录字段绑定到请求体顶层。HTTP headers 由客户端注入。',
  '逐项 JSON-RPC 查询可设 recordsPath:"$"、responseMode:"exchange"，返回 {input,response} 或 {input,error}，保留输入用于关联。',
  '需要节流时用 intervalParameter 引用数值输入。retry 支持 path、encodedPath、decodedPath、value、waitMs，stopOnRateLimit 可在重试仍限流时停止后续请求。',
  'bitable.upsert 用 from、baseToken、target 和 keyExpression。keyExpression 的上下文是单条字段对象，返回字符串键，用于匹配飞书 record_id；也可用 key 指定单字段。',
  '使用用户提供的 Base 和表 ID。完整表达月份、字段映射、业务计算和部分缺数规则。不要发明端点、权限、凭证和算子。',
].join('\n');

export class WorkflowProposalError extends Error {}

function checkExpression(step: Record<string, unknown>, property: 'expression' | 'keyExpression') {
  const source = step[property];
  if (typeof source !== 'string') return;
  try {
    flowExpression(source);
  } catch (error) {
    const detail = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
    const message =
      typeof detail.message === 'string' ? detail.message.slice(0, 140) : '无效表达式';
    const stepId = typeof step.id === 'string' && /^[\w-]{1,64}$/.test(step.id) ? step.id : '?';
    throw new WorkflowProposalError(
      '步骤 ' +
        stepId +
        ' 的 ' +
        property +
        ' 语法错误，位置 ' +
        String(detail.position ?? '?') +
        '。' +
        message,
    );
  }
}

export function compileWorkflowProposal(
  source: ReturnType<typeof parseCurl>['request'],
  json: string,
  id: string,
  goal: string,
) {
  const definition = JSON.parse(json) as { inputs?: unknown; steps?: unknown };
  if (!definition || !Array.isArray(definition.steps) || definition.steps.length > 24)
    throw new Error('流程步骤缺失或过多');
  const sourceUrl = new URL(source.url);
  const method = source.method ?? 'GET';
  const steps = definition.steps.map((step: Record<string, unknown>) => {
    if (step?.op === 'records.transform') checkExpression(step, 'expression');
    if (step?.op === 'bitable.upsert') checkExpression(step, 'keyExpression');
    if (step?.op === 'http.read') {
      if (step.url !== source.url || (step.method ?? 'GET') !== method)
        throw new Error('HTTP 请求地址和方法必须与提供的 cURL 一致');
      return { ...step, headers: source.headers, readOnly: source.readOnly };
    }
    if (step?.op === 'bitable.read' || step?.op === 'bitable.upsert') {
      const table = step.op === 'bitable.read' ? step.table : step.target;
      if (
        typeof step.baseToken !== 'string' ||
        !/^[A-Za-z0-9]+$/.test(step.baseToken) ||
        typeof table !== 'string' ||
        !/^tbl[A-Za-z0-9]+$/.test(table) ||
        !goal.includes(step.baseToken) ||
        !goal.includes(table)
      )
        throw new Error('请在对话中提供每张飞书表的 Base 和表 ID');
      return step;
    }
    if (step?.op !== 'records.transform' && step?.op !== 'records.map')
      throw new Error('草稿含有不支持的算子');
    return step;
  });
  if (
    !steps.some((step) => step.op === 'http.read') ||
    !steps.some((step) => step.op === 'bitable.upsert')
  )
    throw new Error('草稿需要 HTTP 读取和飞书写入');
  return validateFlow(
    {
      id,
      version: '1.0.0',
      schemaVersion: 1,
      inputs: definition.inputs,
      endpoints: [endpoint(sourceUrl, method)],
    },
    { steps },
  );
}
