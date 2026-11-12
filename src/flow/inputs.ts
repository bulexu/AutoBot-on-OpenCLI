export type InputValue = string | number | boolean;
export type FlowInput = {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'month';
  required?: boolean;
  min?: number;
  max?: number;
  default?: InputValue;
};

function matches(input: FlowInput, value: unknown): value is InputValue {
  if (input.type === 'month')
    return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
  if (input.type === 'number')
    return (
      typeof value === 'number' &&
      Number.isFinite(value) &&
      value >= (input.min ?? -Infinity) &&
      value <= (input.max ?? Infinity)
    );
  return typeof value === input.type;
}

export function validateInputs(value: unknown): FlowInput[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('manifest.inputs 必须为数组');
  const keys = new Set<string>();
  return value.map((input: FlowInput) => {
    if (
      !input ||
      typeof input.key !== 'string' ||
      !/^[a-zA-Z][\w-]{0,63}$/.test(input.key) ||
      keys.has(input.key) ||
      typeof input.label !== 'string' ||
      !input.label.trim() ||
      !['string', 'number', 'boolean', 'month'].includes(input.type) ||
      (input.min !== undefined && (input.type !== 'number' || !Number.isFinite(input.min))) ||
      (input.max !== undefined && (input.type !== 'number' || !Number.isFinite(input.max))) ||
      (input.min ?? -Infinity) > (input.max ?? Infinity) ||
      (input.required !== undefined && typeof input.required !== 'boolean') ||
      (input.default !== undefined && !matches(input, input.default))
    ) {
      throw new Error('无效或重复的流程参数声明');
    }
    keys.add(input.key);
    return input;
  });
}

export function resolveInputs(definitions: FlowInput[], raw: unknown = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('流程参数必须为对象');
  for (const key of Object.keys(raw)) {
    if (!definitions.some((input) => input.key === key))
      throw new Error(`未声明的流程参数：${key}`);
  }
  const values = raw as Record<string, unknown>;
  return Object.fromEntries(
    definitions.flatMap((input) => {
      const value = Object.hasOwn(values, input.key) ? values[input.key] : input.default;
      if (value === undefined || value === '') {
        if (input.required) throw new Error(`请填写 ${input.label}`);
        return [];
      }
      if (!matches(input, value))
        throw new Error(
          `${input.label} 格式无效（${input.type === 'month' ? 'YYYY-MM' : input.type}）`,
        );
      return [[input.key, value] as const];
    }),
  );
}
