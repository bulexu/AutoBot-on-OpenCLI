import type { Workflow } from '../flow/workflow.ts';
import { validateServiceBindings } from '../runtime/service-bindings.ts';

const feishu = [
  { name: 'lark-app-id', label: '飞书 App ID', origin: 'https://open.feishu.cn' },
  { name: 'lark-app-secret', label: '飞书 App Secret', origin: 'https://open.feishu.cn' },
];

export function bindingFields(workflow: Workflow) {
  const credentials = new Map<string, { name: string; label: string; origin: string }>();
  const targets = new Set<string>();
  for (const step of workflow.steps) {
    if (step.op === 'competitor.monthly') {
      for (const item of feishu) credentials.set(item.name, item);
      credentials.set('sellersprite-secret-key', {
        name: 'sellersprite-secret-key',
        label: '卖家精灵 Secret Key',
        origin: 'https://mcp.sellersprite.com',
      });
    } else if (step.op === 'bitable.upsert' || step.op === 'bitable.read') {
      for (const item of feishu) credentials.set(item.name, item);
      if (step.op === 'bitable.upsert' && !step.baseToken) targets.add(step.target);
    } else if (step.op === 'http.read') {
      for (const [header, value] of Object.entries(step.headers ?? {})) {
        const name = value.match(/^\{\{secret\.([\w-]+)\}\}$/)?.[1];
        if (!name) continue;
        const origin = new URL(step.url).origin;
        if (credentials.has(name) && credentials.get(name)?.origin !== origin) {
          throw new Error('同名凭证绑定到多个来源');
        }
        credentials.set(name, { name, origin, label: `${header} · ${origin}` });
      }
    }
  }
  return { credentials: [...credentials.values()], targets: [...targets] };
}

export function readDesktopBindings(workflow: Workflow, value: unknown) {
  const fields = bindingFields(workflow);
  // The first desktop build stored the three competitor credentials as an array.
  const raw = Array.isArray(value) ? { values: value } : value;
  if (
    !raw ||
    typeof raw !== 'object' ||
    !('values' in raw) ||
    !Array.isArray(raw.values) ||
    raw.values.length !== fields.credentials.length
  )
    throw new Error('凭证配置不完整');
  const values = raw.values as unknown[];
  const credentials = new Map(
    fields.credentials.map((field, index) => {
      const item = values[index];
      if (typeof item !== 'string' || !item.trim() || item.length > 4096) {
        throw new Error('请填写所需凭证');
      }
      return [field.name, { origin: field.origin, value: item }];
    }),
  );
  const bindings = validateServiceBindings('bindings' in raw ? raw.bindings : undefined);
  if (
    fields.targets.some(
      (target) => !bindings.bitable || !Object.hasOwn(bindings.bitable.targets, target),
    )
  )
    throw new Error('请填写目标表绑定');
  return { credentials, bindings };
}

/**
 * Keeps the previously saved credential when a field is submitted empty, so an
 * already configured flow can be saved without retyping every secret.
 */
export function mergeDesktopBindings(workflow: Workflow, submitted: unknown, saved: unknown) {
  const fields = bindingFields(workflow);
  const asRecord = (value: unknown): Record<string, unknown> | undefined =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  const previous = Array.isArray(saved) ? { values: saved } : asRecord(saved);
  const previousValues = Array.isArray(previous?.values) ? (previous.values as unknown[]) : [];
  const raw = Array.isArray(submitted) ? { values: submitted } : asRecord(submitted);
  if (!raw || !Array.isArray(raw.values)) {
    throw new Error('凭证配置不完整');
  }
  const values = (raw.values as unknown[]).map((item, index) => {
    if (typeof item === 'string' && item.trim()) return item;
    const kept = previousValues[index];
    return typeof kept === 'string' ? kept : item;
  });
  const merged: Record<string, unknown> = { ...raw, values };
  if (fields.targets.length && 'bindings' in raw) {
    const bindings = raw.bindings as
      { bitable?: { baseToken?: string; targets?: Record<string, string> } } | undefined;
    const previousBindings = previous?.bindings as
      { bitable?: { baseToken?: string; targets?: Record<string, string> } } | undefined;
    const targets = { ...(bindings?.bitable?.targets ?? {}) };
    for (const target of fields.targets) {
      if (targets[target]?.trim()) continue;
      const kept = previousBindings?.bitable?.targets?.[target];
      if (kept?.trim()) targets[target] = kept;
    }
    const baseToken = bindings?.bitable?.baseToken?.trim()
      ? bindings.bitable.baseToken
      : (previousBindings?.bitable?.baseToken ?? '');
    merged.bindings = { ...bindings, bitable: { baseToken, targets } };
  }
  return merged;
}
