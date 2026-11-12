import { CronExpressionParser } from 'cron-parser';
import { resolveInputs } from '../flow/inputs.ts';
import type { FlowInput, InputValue } from '../flow/inputs.ts';

export type FlowPreferences = {
  alias?: string;
  month?: string;
  inputs?: Record<string, InputValue>;
  cron?: string;
  since?: number;
};

export function parseFlowPreferences(
  value: unknown,
  definitions: FlowInput[],
  previous: FlowPreferences,
  now = Date.now(),
): FlowPreferences {
  if (
    !value ||
    typeof value !== 'object' ||
    !('alias' in value) ||
    !('cron' in value) ||
    !('inputs' in value) ||
    typeof value.alias !== 'string' ||
    typeof value.cron !== 'string'
  )
    throw new Error('无效的流程设置');

  const alias = value.alias.trim();

  const cron = value.cron.trim();
  if (alias.length > 80) throw new Error('别名最多 80 个字符');
  if (!value.inputs || typeof value.inputs !== 'object' || Array.isArray(value.inputs))
    throw new Error('无效的流程参数');
  if (cron || Object.keys(value.inputs).length) resolveInputs(definitions, value.inputs);
  if (cron) {
    if (cron.split(/\s+/).length !== 5 || cron.length > 120) {
      throw new Error('请输入五段 Cron 表达式，例如 0 9 * * 1-5');
    }
    try {
      CronExpressionParser.parse(cron);
    } catch {
      throw new Error('Cron 表达式无效');
    }
  }
  return {
    alias: alias || undefined,
    inputs: value.inputs as Record<string, InputValue>,
    cron: cron || undefined,
    since: cron ? (cron === previous.cron ? (previous.since ?? now) : now) : undefined,
  };
}

export function dueOccurrence(preferences: FlowPreferences, now = Date.now()) {
  if (!preferences.cron || preferences.since === undefined || preferences.since >= now) return;
  const latest = CronExpressionParser.parse(preferences.cron, { currentDate: new Date(now + 1) })
    .prev()
    .getTime();
  if (latest > preferences.since) return latest;
}

export function savedInputs(preferences: FlowPreferences, definitions: FlowInput[]) {
  const legacy =
    preferences.month &&
    definitions.some((input) => input.key === 'month' && input.type === 'month')
      ? { month: preferences.month }
      : {};
  const saved = preferences.inputs ?? legacy;
  return Object.fromEntries(
    Object.entries(saved).filter(([key]) => definitions.some((input) => input.key === key)),
  );
}
