import { createBitableWriter } from '../integrations/bitable.ts';
import { createFeishuRecords } from '../integrations/feishu-fields.ts';
import { createCompetitorMonthlyRunner } from './competitor-monthly.ts';
import type { ExecutionOptions } from './execute.ts';

export type ServiceBindings = {
  productFilter?: string;
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
): Pick<ExecutionOptions, 'competitorMonthly' | 'upsert'> {
  const application = () => ({
    appId: requiredCredential(credentials, 'lark-app-id', 'https://open.feishu.cn'),
    appSecret: requiredCredential(credentials, 'lark-app-secret', 'https://open.feishu.cn'),
  });
  const bitable = bindings.bitable;
  let transport: ReturnType<typeof createFeishuRecords> | undefined;
  return {
    competitorMonthly: (step, options) =>
      createCompetitorMonthlyRunner(
        application(),
        requiredCredential(credentials, 'sellersprite-secret-key', 'https://mcp.sellersprite.com'),
        bindings.productFilter,
      )(step, options),
    upsert:
      bitable &&
      (async (step, records) => {
        const table = Object.hasOwn(bitable.targets, step.target) && bitable.targets[step.target];
        if (!table) throw new Error(`Missing Bitable target binding: ${step.target}`);
        transport ??= createFeishuRecords(application(), bitable.baseToken);
        const writer = createBitableWriter(await transport, 100);
        await writer({ ...step, target: table }, records);
      }),
  };
}

export function validateServiceBindings(value: unknown): ServiceBindings {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid service bindings');
  }
  const result: ServiceBindings = {};
  if ('productFilter' in value && value.productFilter !== undefined) {
    if (typeof value.productFilter !== 'string' || !value.productFilter.trim()) {
      throw new Error('Invalid product filter');
    }
    result.productFilter = value.productFilter;
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
    ) {
      throw new Error('Invalid Bitable bindings');
    }
    const entries = Object.entries(binding.targets);
    if (entries.some(([, id]) => typeof id !== 'string' || !id.trim())) {
      throw new Error('Invalid Bitable table binding');
    }
    result.bitable = { baseToken: binding.baseToken, targets: Object.fromEntries(entries) };
  }
  return result;
}
