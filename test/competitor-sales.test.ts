import { DesignConversation } from '../src/design/conversation.ts';
import { createProposer } from '../src/design/model.ts';
import { startDesign } from '../src/design/session.ts';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { bindingFields } from '../src/desktop/flow-bindings.ts';
import { importFlowPackage } from '../src/flow/package.ts';
import { executeOpenCliCommand } from '../src/integrations/opencli-command.ts';
import { RunStore } from '../src/storage/run-store.ts';

test('the October package previews, writes numeric values, and replays without duplicates', async (t) => {
  let includeMissingSite = false;
  let modelWorkflow: string;
  let retryOnce = false;
  let frenchVariations = 0;
  let sharedParent = false;
  const requestTimes: number[] = [];
  const detail: { record_id: string; fields: Record<string, unknown> }[] = [];
  const summary: typeof detail = [];
  const generic: typeof detail = [];
  const envelope = (data: unknown) => Response.json({ code: 0, data });

  t.mock.method(globalThis, 'fetch', async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input);
    if (url.hostname === 'model.example') {
      assert.equal(url.pathname, '/v1/chat/completions');
      const request = JSON.parse(String(init?.body));
      assert.match(request.messages[0].content, /多表流程直接输出/);
      assert.match(request.messages[1].content, /BaseFlowRef1/);
      assert.doesNotMatch(
        request.messages[1].content,
        /ViXsbD4aLa3ja5ss0jtcyPedngh|tbl4IFfAMtykDmb2/,
      );
      return Response.json({
        id: 'fixture',
        object: 'chat.completion',
        model: 'fixture',
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: { role: 'assistant', content: modelWorkflow },
          },
        ],
      });
    }
    if (url.hostname === 'source.example') return Response.json([{ id: 'generic-record' }]);
    if (url.hostname === 'mcp.sellersprite.com') {
      requestTimes.push(performance.now());
      const { params } = JSON.parse(String(init?.body));
      assert.equal(params.name, 'asin_sales_trend');
      if (retryOnce) {
        retryOnce = false;
        return Response.json({
          jsonrpc: '2.0',
          id: 1,
          result: {
            content: [{ text: JSON.stringify({ code: 'ERROR_MAXIMUM_ACCESS_PER_MINUTE' }) }],
          },
        });
      }
      if (params.arguments.marketplace === 'FR')
        return Response.json({
          jsonrpc: '2.0',
          id: 1,
          result: {
            structuredContent: {
              asin: { parent: 'B0PARENT01', variations: frenchVariations },
              salesTrendPoints: frenchVariations
                ? [{ month: '2026-10', price: 5, parentUnitSales: 3, parentSalesRevenue: 15 }]
                : [],
            },
          },
        });
      const payload = {
        asin: { parent: 'B0DDXCM29Z', variations: 2 },
        salesTrendPoints: [
          {
            month: '2026-10',
            childUnitSales: 4,
            price: 5,
            childSalesRevenue: 20,
            parentUnitSales: 4,
            parentSalesRevenue: 20,
          },
        ],
      };
      const message = {
        jsonrpc: '2.0',
        id: 1,
        result: { content: [{ text: JSON.stringify(payload) }] },
      };
      return new Response('data: ' + JSON.stringify(message) + '\n\n', {
        headers: { 'content-type': 'text/event-stream' },
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
          {
            fields: {
              监控状态: '监控中',
              美国: {
                link: sharedParent
                  ? 'https://www.amazon.com/dp/B0OTHER001'
                  : 'https://www.amazon.com/dp/B0DDXCM29Z',
              },
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
  const declarative = importFlowPackage(
    await readFile(new URL('../examples/competitor-sales-declarative.flow', import.meta.url)),
  );
  assert.ok(declarative.workflow.steps.every((step) => step.op !== 'competitor.monthly'));
  assert.deepEqual(
    bindingFields(declarative.workflow).credentials.map(({ name, origin }) => ({ name, origin })),
    bindingFields(workflow).credentials.map(({ name, origin }) => ({ name, origin })),
  );
  const directory = await mkdtemp(join(tmpdir(), 'autobot-competitor-'));
  const database = join(directory, 'runs.sqlite');
  const store = new RunStore(database);
  try {
    const run = async (mode: 'preview' | 'replay', migrated = false) => {
      const flow = migrated ? structuredClone(declarative) : { manifest, workflow };
      if (retryOnce) {
        const sales = flow.workflow.steps.find((step) => step.op === 'http.read');
        assert.ok(sales?.retry);
        sales.retry.waitMs = 0;
      }
      const runId = store.start('competitor-test', mode);
      const result = await executeOpenCliCommand(
        Readable.from([
          Buffer.from(
            JSON.stringify({
              ...flow,
              database,
              runId,
              mode,
              bindings: migrated
                ? { inputs: { requestIntervalMs: 30 } }
                : { inputs: { requestIntervalMs: 30 }, productFilter: 'Fixture' },
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
      assert.equal(
        store.pages(runId, migrated ? 'detail-rows' : 'monthly-sales').length,
        result.writes[0].count,
      );
      return result;
    };
    const chat = new DesignConversation();
    const base = 'ViXsbD4aLa3ja5ss0jtcyPedngh';
    const tables = declarative.workflow.steps.flatMap((step) =>
      step.op === 'bitable.read' ? [step.table] : step.op === 'bitable.upsert' ? [step.target] : [],
    );
    const generatedSteps = structuredClone(declarative.workflow.steps);
    const candidates = generatedSteps.find(
      (step) => step.op === 'records.transform' && step.id === 'candidates',
    );
    assert.ok(candidates?.op === 'records.transform');
    candidates.expression = candidates.expression.replace(
      /\{"records": \[mode[^\n]+/,
      '{"records": $unique}',
    );
    modelWorkflow = JSON.stringify({
      inputs: declarative.manifest.inputs,
      steps: generatedSteps,
    }).replaceAll(base, 'BaseFlowRef1');
    for (const [index, table] of tables.entries())
      modelWorkflow = modelWorkflow.replaceAll(table, 'tblFlowRef' + (index + 2));
    let generated: Awaited<ReturnType<typeof startDesign>> | undefined;
    const design = async (input: Parameters<typeof startDesign>[0]) => {
      generated = await startDesign(
        input,
        createProposer({
          apiKey: 'fixture',
          model: 'fixture',
          baseURL: 'https://model.example/v1',
        }),
        async (flow) => {
          const runId = store.start('design-preview', 'preview');
          return await executeOpenCliCommand(
            Readable.from([
              Buffer.from(
                JSON.stringify({
                  ...flow,
                  database,
                  runId,
                  mode: 'preview',
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
        },
      );
      return generated.state;
    };
    await chat.send(
      `在飞书 Base ${base} 读取汇率和竞品，生成销量明细与汇总，四张表为 ${tables.join('、')}`,
      design,
    );
    const confirmation = await chat.send(
      "curl https://mcp.sellersprite.com/mcp -H 'secret-key: {{secret.sellersprite-secret-key}}' -d '{}'",
      design,
    );
    assert.equal(confirmation.confirmPost, true);
    await chat.send('确认只读 POST', design);
    const response = await chat.send('{"result":{"salesTrendPoints":[]}}', design);
    assert.equal(response.result?.ready, true);
    assert.ok(generated);
    const exported = importFlowPackage(await generated.confirm());
    assert.deepEqual(
      exported.workflow.steps.map((step) => step.op),
      declarative.workflow.steps.map((step) => step.op),
    );
    const preview = await run('preview');
    assert.deepEqual(structuredClone(generated.state.preview), preview);
    assert.deepEqual(
      preview.writes.map((write) => write.count),
      [1, 1],
    );
    assert.deepEqual(structuredClone(await run('preview', true)), preview);
    assert.equal(detail.length + summary.length, 0);
    retryOnce = true;
    requestTimes.length = 0;
    assert.deepEqual(structuredClone(await run('preview', true)), preview);
    assert.equal(requestTimes.length, 2);
    assert.ok(requestTimes[1] - requestTimes[0] >= 29);
    const replay = await run('replay');
    const written = structuredClone({ detail, summary });
    assert.deepEqual(await run('replay', true), replay);
    assert.deepEqual({ detail, summary }, written);
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
    requestTimes.length = 0;
    assert.deepEqual(await run('replay', true), partial);
    assert.equal(requestTimes.length, 2);
    assert.ok(requestTimes[1] - requestTimes[0] >= 29);
    frenchVariations = 1;
    const singleVariant = await run('preview', true);
    assert.equal(singleVariant.warnings, undefined);
    assert.equal(
      singleVariant.writes[0].records?.find((row) => row.平台 === 'amazon-法国')?.销量,
      3,
    );
    assert.equal(singleVariant.writes[1].records?.[0]?.销量, 7);
    frenchVariations = 2;
    const multiVariant = await run('preview', true);
    assert.equal(multiVariant.warnings, undefined);
    assert.equal(multiVariant.writes[1].records?.[0]?.销量, 7);
    includeMissingSite = false;
    sharedParent = true;
    const deduplicated = await run('preview', true);
    assert.equal(deduplicated.writes[0].count, 1);
    assert.equal(deduplicated.writes[1].records?.[0]?.销量, 4);
    sharedParent = false;
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
