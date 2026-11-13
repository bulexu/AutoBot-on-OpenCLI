import type { RunRecord } from '@/ipc';

/** Shared formatters for run records, so every view renders the same numbers. */

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' });
const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });

export { dateFormat, timeFormat };

export function formatDuration(startedAt: string | null, finishedAt: string | null) {
  if (!startedAt) return '—';
  if (!finishedAt) return '进行中';
  const milliseconds = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '—';
  return formatSpan(milliseconds);
}

export function formatSpan(milliseconds: number) {
  if (milliseconds < 1000) return '不足 1 秒';
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 60) return seconds + ' 秒';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + ' 分 ' + (seconds % 60) + ' 秒';
  return Math.floor(minutes / 60) + ' 时 ' + (minutes % 60) + ' 分';
}

export function formatElapsed(startedAt: string) {
  const milliseconds = Date.now() - new Date(startedAt).getTime();
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '';
  return formatSpan(milliseconds);
}

export const statusLabels: Record<string, string> = {
  running: '运行中',
  succeeded: '成功',
  incomplete: '未完成',
  partial: '部分完成',
};

export function runStatus(record: Pick<RunRecord, 'status' | 'failure_code'>) {
  return record.status === 'incomplete' && record.failure_code === 'PARTIAL_RESULT'
    ? 'partial'
    : record.status;
}

export const modeLabels: Record<string, string> = {
  preview: '只读预览',
  replay: '正式执行',
};

/**
 * Explains why a run stopped. Everything here comes from what the run actually
 * recorded — the code, the raw message and the step that raised it — so the
 * panel never invents a cause the runtime did not report.
 */
export const failureAdvice: Record<string, string> = {
  TIMEOUT: '请求超过了 30 秒的单次超时限制。可稍后重试，或检查目标服务是否响应过慢。',
  CREDENTIAL_MISSING: '缺少该流程所需的凭证。请到「工作流管理 → 凭证」补全并保存后重试。',
  CREDENTIAL_INVALID: '凭证被目标服务拒绝。请到「工作流管理 → 凭证」更新对应的密钥后重试。',
  FORBIDDEN: '凭证对应的账号没有执行该操作的权限。',
  NOT_FOUND: '流程中声明的接口地址或目标表不存在。请检查流程定义。',
  RATE_LIMITED: '目标服务触发了频率限制。请降低执行频率或稍后重试。',
  NETWORK_ERROR: '无法连接到目标服务。请检查本机网络、代理与域名解析。',
  UPSTREAM_ERROR: '目标服务返回了错误状态码。可在系统设置中确认模型与接口配置后重试。',
  VALIDATION_ERROR: '流程数据不符合预期。请检查流程定义中的字段映射与去重键。',
  PROCESS_FAILED: '执行进程异常退出，未返回结构化结果。请重启客户端后重试。',
  PROCESS_TERMINATED: '执行被终止，可能超出了 300 秒的总时长限制。',
  INVALID_RESPONSE: '执行进程返回了无法解析的结果。请重启客户端后重试。',
  WORKFLOW_FAILED: '执行在返回具体原因前中断。',
};

export const failureSummary: Record<string, string> = {
  TIMEOUT: '请求超时',
  CREDENTIAL_MISSING: '凭证缺失',
  CREDENTIAL_INVALID: '凭证无效',
  FORBIDDEN: '权限不足',
  NOT_FOUND: '目标不存在',
  RATE_LIMITED: '触发限流',
  NETWORK_ERROR: '网络连接失败',
  UPSTREAM_ERROR: '上游服务报错',
  VALIDATION_ERROR: '流程数据校验失败',
  PROCESS_FAILED: '执行进程异常',
  PROCESS_TERMINATED: '执行被终止',
  INVALID_RESPONSE: '结果无法解析',
  WORKFLOW_FAILED: '执行未完成',
  PARTIAL_RESULT: '部分完成',
};
