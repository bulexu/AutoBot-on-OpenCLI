import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { importFlowPackage } from '../src/flow/package.ts';
import { executeOpenCliCommand } from '../src/integrations/opencli-command.ts';
import { RunStore } from '../src/storage/run-store.ts';

test('the October package previews, writes numeric values, and replays without duplicates', async (t) => {
  let includeMissingSite = false;
  const requestTimes: number[] = [];
  const detail: { record_id: string; fields: Record<string, unknown> }[] = [];
  const summary: typeof detail = [];
  const generic: typeof detail = [];
  const envelope = (data: unknown) => Response.json({ code: 0, data });

  t.mock.method(globalThis, 'fetch', async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input);
    if (url.hostname === 'source.example') return Response.json([{ id: 'generic-record' }]);
    if (url.hostname === 'mcp.sellersprite.com') {
      requestTimes.push(performance.now());
      const { params } = JSON.parse(String(init?.body));
      assert.equal(params.name, 'asin_sales_trend');
      if (params.arguments.marketplace === 'FR')
        return Response.json({
          jsonrpc: '2.0',
          id: 1,
          result: { structuredContent: { salesTrendPoints: [] } },
        });
      return Response.json({
        jsonrpc: '2.0',
        id: 1,
        result: {
          structuredContent: {
            salesTrendPoints: [
              {
                month: '2026-10',
                childUnitSales: 4,
                price: 5,
                childSalesRevenue: 20,
                parentUnitSales: 99,
              },
            ],
          },
        },
      });
    }
    if (url.pathname.endsWith('/internal')) {
      return Response.json({ code: 0, tenant_access_token: 'fixture-token' });
    }
    const table = url.pathname.split('/')[7];
    if (table === 'tbl4IFfAMtykDmb2') {
      return envelope({
        items: [
          { fields: { 国家: '美国', 代码: 'US', 货币: 'USD', 汇率: '7' } },
          { fields: { 国家: '法国', 代码: 'FR', 货币: 'EUR', 汇率: '8' } },
        ],
        has_more: false,
      });
    }
    if (table === 'tbl1gGQJZpUsUPE8') {
      return envelope({
        items: [
          {
            fields: {
              监控状态: '监控中',
              美国: 'B0DDXCM29Z',
              ...(includeMissingSite ? { 法国: 'B0DDXCM29Z' } : {}),
              产品名: 'Fixture',
              产品线: '码表',
              公司: 'Example',
            },
          },
        ],
        has_more: false,
      });
    }
    const target =
      table === 'tbl3CgYf4xmw1ZTb' ? detail : table === 'generic-table' ? generic : summary;
    if (url.pathname.endsWith('/batch_create')) {
      const { records } = JSON.parse(String(init?.body)) as { records: typeof detail };
      for (const record of records) target.push({ ...record, record_id: 'rec-' + target.length });
    }
    if (url.pathname.endsWith('/batch_update')) {
      const { records } = JSON.parse(String(init?.body)) as { records: typeof detail };
      for (const record of records) {
        const existing = target.find((item) => item.record_id === record.record_id);
        assert.ok(existing);
        existing.fields = record.fields;
      }
    }
    return envelope({ items: target, has_more: false });
  });

  const { manifest, workflow } = importFlowPackage(
    await readFile(new URL('../examples/competitor-sales-2026-10.flow', import.meta.url)),
  );
  const directory = await mkdtemp(join(tmpdir(), 'autobot-competitor-'));
  const database = join(directory, 'runs.sqlite');
  const store = new RunStore(database);
  try {
    const run = async (mode: 'preview' | 'replay') => {
      const runId = store.start('competitor-test', mode);
      const result = await executeOpenCliCommand(
        Readable.from([
          Buffer.from(
            JSON.stringify({
              manifest,
              workflow,
              database,
              runId,
              mode,
              inputs: { requestIntervalMs: 30 },
              bindings: { productFilter: 'Fixture' },
              credentials: [
                { name: 'lark-app-id', origin: 'https://open.feishu.cn', value: 'fixture' },
                { name: 'lark-app-secret', origin: 'https://open.feishu.cn', value: 'fixture' },
                {
                  name: 'sellersprite-secret-key',
                  origin: 'https://mcp.sellersprite.com',
                  value: 'fixture',
                },
              ],
            }),
          ),
        ]),
      );
      store.finish(runId, 'succeeded');
      assert.equal(store.pages(runId, 'monthly-sales').length, 1);
      return result;
    };
    const preview = await run('preview');
    assert.deepEqual(
      preview.writes.map((write) => write.count),
      [1, 1],
    );
    assert.equal(detail.length + summary.length, 0);
    await run('replay');
    await run('replay');
    includeMissingSite = true;
    requestTimes.length = 0;
    const partial = await run('replay');
    assert.equal(requestTimes.length, 2);
    assert.ok(requestTimes[1] - requestTimes[0] >= 29);
    assert.deepEqual(
      partial.writes.map((write) => write.count),
      [1, 0],
    );
    assert.ok(partial.warnings?.some((warning) => warning.includes('缺少 2026-10 月度数据')));
    assert.equal(summary.length, 1);
    includeMissingSite = false;
    const genericRunId = store.start('generic-test', 'replay');
    await executeOpenCliCommand(
      Readable.from([
        Buffer.from(
          JSON.stringify({
            manifest: {
              ...manifest,
              endpoints: [{ method: 'GET', origin: 'https://source.example', path: '/items' }],
            },
            workflow: {
              steps: [
                {
                  id: 'read',
                  op: 'http.read',
                  url: 'https://source.example/items',
                  recordsPath: '$',
                },
                { id: 'write', op: 'bitable.upsert', from: 'read', target: 'generic', key: 'id' },
              ],
            },
            database,
            runId: genericRunId,
            mode: 'replay',
            bindings: {
              bitable: { baseToken: 'example-base', targets: { generic: 'generic-table' } },
            },
            credentials: [
              { name: 'lark-app-id', origin: 'https://open.feishu.cn', value: 'fixture' },
              { name: 'lark-app-secret', origin: 'https://open.feishu.cn', value: 'fixture' },
            ],
          }),
        ),
      ]),
    );
    assert.deepEqual(generic[0].fields, { id: 'generic-record' });
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
  assert.equal(detail.length, 1);
  assert.equal(summary.length, 1);
  assert.equal(detail[0].fields.单价, 5);
  assert.equal(summary[0].fields.客单价, 35);
  assert.equal(summary[0].fields.预估销额, 140);
});
