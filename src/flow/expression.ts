import jsonata from 'jsonata';
import { parseJsonValue } from '../integrations/http-response.ts';

export function flowExpression(source: string) {
  const expression = jsonata(source, { stack: 200, timeout: 1500, sequence: 100_000 });
  expression.assign('eval', undefined);
  expression.registerFunction(
    'parseJSON',
    (value: string) => parseJsonValue(value) ?? null,
    '<s:j>',
  );
  return async (data: unknown) => {
    try {
      return await expression.evaluate(data);
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      const message =
        error && typeof error === 'object' && 'message' in error ? error.message : undefined;
      if (code === 'D3141' && typeof message === 'string')
        throw new Error(message.slice(0, 240), { cause: error });
      const suffix = typeof code === 'string' && /^[A-Z]\d{4}$/.test(code) ? `（${code}）` : '';
      throw new Error('流程记录表达式执行失败' + suffix, { cause: error });
    }
  };
}
