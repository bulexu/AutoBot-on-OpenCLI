import { validMonth } from '../flow/workflow.ts';
import { createCompetitorMonthlyRunner } from './competitor-monthly.ts';
import { createBitableWriter } from '../integrations/bitable.ts';
import { createFeishuRecords } from '../integrations/feishu-fields.ts';
import type { ExecutionOptions } from './execute.ts';

export type ServiceBindings = {
  productFilter?: string;
  month?: string;
  inputs?: Record<string, unknown>;
  bitable?: { baseToken: string; targets: Record<string, string> };
};

function requiredCredential(
  credentials: NonNullable<ExecutionOptions['credentials']>,
  key: string,
  origin: string,
) {
  const binding = credentials.get(key);
  if (!binding?.value || binding.origin !== origin) throw new Error(`Missing binding: ${key}`);
  return binding.value;
}

export function bindServices(
  credentials: NonNullable<ExecutionOptions['credentials']>,
  bindings: ServiceBindings,
): Pick<ExecutionOptions, 'competitorMonthly' | 'bitableRead' | 'upsert'> {
  const transports = new Map<string, ReturnType<typeof createFeishuRecords>>();
  const transportFor = (baseToken: string) => {
    let transport = transports.get(baseToken);
    if (!transport) {
      transport = createFeishuRecords(
        {
          appId: requiredCredential(credentials, 'lark-app-id', 'https://open.feishu.cn'),
          appSecret: requiredCredential(credentials, 'lark-app-secret', 'https://open.feishu.cn'),
        },
        baseToken,
      );
      transports.set(baseToken, transport);
    }
    return transport;
  };
  const bitable = bindings.bitable;
  return {
    bitableRead: async (step) => {
      const rows = [];
      for await (const record of (await transportFor(step.baseToken)).records(
        step.table,
        step.view,
      ))
        rows.push(record.fields);
      return rows;
    },
    competitorMonthly: (step, options) =>
      createCompetitorMonthlyRunner(
        {
          appId: requiredCredential(credentials, 'lark-app-id', 'https://open.feishu.cn'),
          appSecret: requiredCredential(credentials, 'lark-app-secret', 'https://open.feishu.cn'),
        },
        requiredCredential(credentials, 'sellersprite-secret-key', 'https://mcp.sellersprite.com'),
        bindings.productFilter,
      )(step, options),
    upsert: async (step, records, key) => {
      const baseToken = step.baseToken ?? bitable?.baseToken;
      const table = step.baseToken
        ? step.target
        : bitable && Object.hasOwn(bitable.targets, step.target) && bitable.targets[step.target];
      if (!baseToken || !table) throw new Error(`Missing Bitable target binding: ${step.target}`);
      const writer = createBitableWriter(await transportFor(baseToken), 100, key);
      await writer({ ...step, target: table }, records);
    },
  };
}

export function validateServiceBindings(value: unknown): ServiceBindings {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid service bindings');
  }
  const result: ServiceBindings = {};
  if ('productFilter' in value && value.productFilter !== undefined) {
    if (typeof value.productFilter !== 'string' || !value.productFilter.trim())
      throw new Error('Invalid product filter');
    result.productFilter = value.productFilter;
  }
  if ('month' in value && value.month !== undefined) {
    if (!validMonth(value.month)) throw new Error('月份格式应为 YYYY-MM');
    result.month = value.month;
  }
  if ('inputs' in value && value.inputs !== undefined) {
    if (!value.inputs || typeof value.inputs !== 'object' || Array.isArray(value.inputs))
      throw new Error('无效的流程参数');
    result.inputs = value.inputs as Record<string, unknown>;
  }
  if ('bitable' in value && value.bitable !== undefined) {
    const binding = value.bitable;
    if (
      !binding ||
      typeof binding !== 'object' ||
      !('baseToken' in binding) ||
      typeof binding.baseToken !== 'string' ||
      !binding.baseToken.trim() ||
      !('targets' in binding) ||
      !binding.targets ||
      typeof binding.targets !== 'object' ||
      Array.isArray(binding.targets)
    )
      throw new Error('Invalid Bitable bindings');
    const entries = Object.entries(binding.targets);
    if (entries.some(([, id]) => typeof id !== 'string' || !id.trim()))
      throw new Error('Invalid Bitable table binding');
    result.bitable = { baseToken: binding.baseToken, targets: Object.fromEntries(entries) };
  }
  return result;
}
