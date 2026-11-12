/**
 * Maps a runtime failure onto a stable code so the desktop UI can explain why a
 * run stopped. The raw message stays the primary diagnostic; the code only
 * drives the badge and the suggested remedy.
 */
const rules: [RegExp, string][] = [
  [/timed?\s*out|etimedout|aborted|timeout/i, 'TIMEOUT'],
  [/missing binding|is required|请填写所需凭证|凭证配置不完整/i, 'CREDENTIAL_MISSING'],
  [
    /\b401\b|unauthorized|credential binding unavailable|rejected the request|invalid.*credential/i,
    'CREDENTIAL_INVALID',
  ],
  [/\b403\b|forbidden/i, 'FORBIDDEN'],
  [/\b404\b|not found/i, 'NOT_FOUND'],
  [/\b429\b|too many requests|rate limit/i, 'RATE_LIMITED'],
  [/econnrefused|enotfound|econnreset|eai_again|socket hang up|fetch failed/i, 'NETWORK_ERROR'],
  [/\b5\d\d\b|feishu api error|sellersprite http/i, 'UPSTREAM_ERROR'],
  [
    /duplicate|missing source record key|exceeded its page limit|must be|is invalid|invalid /i,
    'VALIDATION_ERROR',
  ],
];

export function classifyFailure(message: string): string {
  for (const [pattern, code] of rules) if (pattern.test(message)) return code;
  return 'WORKFLOW_FAILED';
}

/**
 * Describes a failure of the worker process itself, where no step ran and no
 * message came back from the child.
 */
export function describeProcessFailure(code: string): string {
  switch (code) {
    case 'PROCESS_FAILED':
      return '执行进程异常退出，未返回结构化结果。';
    case 'PROCESS_TERMINATED':
      return '执行进程被终止，可能超出了 300 秒的超时限制。';
    case 'INVALID_RESPONSE':
      return '执行进程返回了无法解析的结果。';
    default:
      return '执行在返回具体原因前中断。';
  }
}

/**
 * Tags an error with the step that raised it, so the UI can point at the
 * failing step instead of only reporting that something went wrong.
 *
 * The original error is kept as the thrown value so that callers matching on
 * their own error types (`BitableWriteError` and friends) keep working.
 */
export function tagStepFailure(error: unknown, stepId: string): unknown {
  if (error instanceof Error) {
    Object.defineProperty(error, 'stepId', { value: stepId, enumerable: true });
    return error;
  }
  return new Error(String(error));
}

/** The step an error was tagged with, when it came from a flow step. */
export function failureStep(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'stepId' in error) {
    const stepId = (error as { stepId?: unknown }).stepId;
    if (typeof stepId === 'string') return stepId;
  }
  return undefined;
}
