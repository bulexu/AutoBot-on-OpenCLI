import { at } from '../flow/workflow.ts';

function decode(body: string, contentType: string) {
  if (!contentType.includes('text/event-stream')) return JSON.parse(body) as unknown;
  for (const event of body.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data) continue;
    const message: unknown = JSON.parse(data);
    if (at(message, 'id') === 1) return message;
  }
  throw new Error('SellerSprite SSE response did not contain the tool result');
}

export async function readMonthlySales(
  secret: string,
  marketplace: string,
  asin: string,
  month: string,
) {
  const response = await fetch('https://mcp.sellersprite.com/mcp', {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'secret-key': secret,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'asin_sales_trend', arguments: { marketplace, asin } },
    }),
  });
  if (!response.ok) throw new Error(`SellerSprite HTTP ${response.status}`);
  const message = decode(await response.text(), response.headers.get('content-type') ?? '');
  if (at(message, 'error') || at(message, 'result.isError')) {
    throw new Error(`SellerSprite rejected the request for ${marketplace}/${asin}`);
  }

  const text = at(message, 'result.content.0.text');
  const data =
    at(message, 'result.structuredContent') ??
    (typeof text === 'string' ? (JSON.parse(text) as unknown) : at(message, 'result'));
  const months =
    at(data, 'salesTrendPoints') ??
    at(data, 'data.salesTrendPoints') ??
    at(data, 'data.data.salesTrendPoints');
  if (!Array.isArray(months))
    throw new Error(
      `SellerSprite response is missing salesTrendPoints for ${marketplace}/${asin} (code: ${String(at(data, 'code') ?? 'unknown')})`,
    );
  const row = months.find((item) => at(item, 'month') === month);
  if (!row) return undefined;
  const product = at(data, 'data.asin') ?? at(data, 'asin');
  const hasChild = at(row, 'childUnitSales') != null && at(row, 'childSalesRevenue') != null;
  const isSingleVariant = at(product, 'parent') === asin && at(product, 'variations') === 1;
  if (
    !hasChild &&
    (!isSingleVariant ||
      at(row, 'parentUnitSales') == null ||
      at(row, 'parentSalesRevenue') == null)
  )
    return undefined;

  const number = (key: string) => {
    const value = at(row, key);
    const parsed =
      typeof value === 'number' || (typeof value === 'string' && value.trim())
        ? Number(value)
        : NaN;
    if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid SellerSprite ${key}`);
    return parsed;
  };
  return {
    sales: number(hasChild ? 'childUnitSales' : 'parentUnitSales'),
    price: number('price'),
    amount: number(hasChild ? 'childSalesRevenue' : 'parentSalesRevenue'),
  };
}
