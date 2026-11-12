import jsonata from 'jsonata';

export function flowExpression(source: string) {
  const expression = jsonata(source, { stack: 200, timeout: 1500, sequence: 100_000 });
  expression.assign('eval', undefined);
  return async (data: unknown) => {
    try {
      return await expression.evaluate(data);
    } catch {
      throw new Error('流程记录表达式执行失败');
    }
  };
}
