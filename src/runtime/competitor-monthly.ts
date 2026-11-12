import type { RecordData } from '../flow/workflow.ts';
import { createBitableWriter } from '../integrations/bitable.ts';
import { createFeishuRecords } from '../integrations/feishu-fields.ts';
import { readMonthlySales } from '../integrations/sellersprite.ts';
import type { ExecutionOptions } from './execute.ts';

const sites = {
  德国: 'amazon.de',
  英国: 'amazon.co.uk',
  法国: 'amazon.fr',
  意大利: 'amazon.it',
  西班牙: 'amazon.es',
  美国: 'amazon.com',
  日本: 'amazon.co.jp',
};

export function extractAsin(value: unknown): string | undefined {
  if (value && typeof value === 'object' && 'link' in value) value = value.link;
  if (typeof value !== 'string') return undefined;
  return (
    value
      .trim()
      .match(/^([a-z0-9]{10})$/i)?.[1]
      ?.toUpperCase() ??
    value.match(/\/(?:dp|gp\/product)\/([a-z0-9]{10})(?:[/?#]|$)/i)?.[1]?.toUpperCase()
  );
}

function keyFor(row: RecordData, fields: string[]): string | undefined {
  const parts = fields.map((field) =>
    field === '商品链接' ? extractAsin(row[field]) : row[field],
  );
  if (parts.some((part) => typeof part !== 'string' || !part.trim())) return undefined;
  return JSON.stringify(parts);
}

export function createCompetitorMonthlyRunner(
  application: { appId: string; appSecret: string },
  sellerSecret: string,
  productFilter?: string,
): NonNullable<ExecutionOptions['competitorMonthly']> {
  return async (step, options) => {
    if (!sellerSecret) throw new Error('SELLERSPRITE_SECRET_KEY is required');
    const transport = await createFeishuRecords(application, step.baseToken);
    const rates = new Map<string, { marketplace: string; currency: string; rate: number }>();
    for await (const { fields } of transport.records(step.tables.rates)) {
      const rate = Number(fields.汇率);
      if (
        typeof fields.国家 === 'string' &&
        typeof fields.代码 === 'string' &&
        typeof fields.货币 === 'string' &&
        Number.isFinite(rate) &&
        rate > 0
      ) {
        rates.set(fields.国家.trim(), {
          marketplace: fields.代码.trim(),
          currency: fields.货币.trim(),
          rate,
        });
      }
    }
    const candidates = new Map<
      string,
      { site: keyof typeof sites; asin: string; product: string; line: string; company: string }
    >();
    for await (const { fields } of transport.records(step.tables.competitors)) {
      if (fields.监控状态 !== '监控中') continue;
      for (const site of Object.keys(sites) as (keyof typeof sites)[]) {
        if (!fields[site]) continue;
        const asin = extractAsin(fields[site]);
        if (!asin) throw new Error(`Unsupported competitor ASIN or URL for ${site}`);
        const { 产品名: product, 产品线: line, 公司: company } = fields;
        if (
          typeof product !== 'string' ||
          !product.trim() ||
          typeof line !== 'string' ||
          !line.trim() ||
          typeof company !== 'string' ||
          !company.trim()
        ) {
          throw new Error(
            `Competitor ${site}/${asin} is missing product, product line, or company`,
          );
        }
        const identity = `${site}/${asin}`;
        const previous = candidates.get(identity);
        if (
          previous &&
          (previous.product !== product || previous.line !== line || previous.company !== company)
        ) {
          throw new Error(`Conflicting competitor bindings for ${identity}`);
        }
        candidates.set(identity, { site, asin, product, line, company });
      }
    }

    const detail: RecordData[] = [];
    const groups = new Map<
      string,
      { product: string; line: string; company: string; sales: number; amount: number }
    >();
    const missing: string[] = [];
    const selected = [...candidates.values()]
      .filter((candidate) => !productFilter || candidate.product === productFilter)
      .slice(0, options.mode === 'preview' && !productFilter ? 2 : undefined);
    for (const candidate of selected) {
      const { site, asin, product, line, company } = candidate;
      const rate = rates.get(site);
      if (!rate) throw new Error(`Exchange rate is missing for ${site}`);
      const monthly = await readMonthlySales(sellerSecret, rate.marketplace, asin, step.month);
      if (!monthly) {
        missing.push(`${rate.marketplace}/${asin}`);
        continue;
      }
      const amount = monthly.amount * rate.rate;
      const detailRow = {
        月份: step.month,
        商品链接: `https://www.${sites[site]}/dp/${asin}`,
        平台: `amazon-${site}`,
        产品名: product,
        销量: monthly.sales,
        币种: rate.currency,
        单价: monthly.price,
        '销额（原币）': monthly.amount,
        汇率: rate.rate,
        '销额（CNY）': amount,
      };
      detail.push(detailRow);
      options.savePage?.(step.id, detail.length, [detailRow]);
      const groupKey = JSON.stringify([product, line, company]);
      const group = groups.get(groupKey) ?? { product, line, company, sales: 0, amount: 0 };
      group.sales += monthly.sales;
      group.amount += amount;
      groups.set(groupKey, group);
    }
    if (missing.length)
      throw new Error(
        `Missing ${step.month} sales for ${missing.length} of ${selected.length} requests (first: ${missing[0]})`,
      );
    if (detail.length === 0) throw new Error(`No competitor sales found for ${step.month}`);

    const summary = [...groups.values()].map((group) => ({
      月份: step.month,
      产品名: group.product,
      产品线: group.line,
      公司: group.company,
      销量: group.sales,
      客单价: group.sales ? group.amount / group.sales : 0,
      预估销额: group.amount,
    }));
    const outputs = [
      {
        stepId: 'detail',
        target: step.tables.detail,
        records: detail,
        keys: ['月份', '平台', '商品链接'],
      },
      {
        stepId: 'summary',
        target: step.tables.summary,
        records: summary,
        keys: ['月份', '产品名', '产品线', '公司'],
      },
    ];

    for (const output of outputs) {
      const keys = new Set(output.records.map((row) => keyFor(row, output.keys)));
      if (keys.has(undefined) || keys.size !== output.records.length)
        throw new Error('Invalid or duplicate sales record key');
    }
    if (options.mode === 'replay') {
      for (const output of outputs) {
        const writer = createBitableWriter(transport, 100, (row) => keyFor(row, output.keys));
        await writer(
          {
            id: output.stepId,
            op: 'bitable.upsert',
            from: step.id,
            target: output.target,
            key: '',
          },
          output.records,
        );
      }
    }

    return outputs.map((output) => ({
      stepId: output.stepId,
      target: output.target,
      count: output.records.length,
      ...(options.mode === 'preview' ? { records: output.records } : {}),
    }));
  };
}
