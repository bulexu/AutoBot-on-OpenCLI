import { resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { exportFlowPackage, importFlowPackage } from '../src/flow/package.ts';
import { bundledOpenCliEntry } from '../src/integrations/opencli.ts';
import { OpenCliRunner } from '../src/runtime/opencli-runner.ts';

const [command, file = 'examples/competitor-sales-2026-10.flow', scope] = process.argv.slice(2);

if (command === 'pack') {
  const manifest = {
    id: 'competitor-monthly-sales',
    version: '1.1.0',
    schemaVersion: 1,
    inputs: [
      {
        key: 'month',
        label: '抓取月份',
        type: 'month',
        required: true,
        default: scope ?? '2026-10',
      },
      {
        key: 'requestIntervalMs',
        label: '卖家精灵请求间隔（毫秒）',
        type: 'number',
        default: 2000,
        min: 0,
        max: 10000,
      },
    ],
    endpoints: [{ method: 'POST', origin: 'https://mcp.sellersprite.com', path: '/mcp' }],
  };
  const workflow = {
    steps: [
      {
        id: 'monthly-sales',
        op: 'competitor.monthly',
        tool: 'asin_sales_trend',
        monthParameter: 'month',
        requestIntervalParameter: 'requestIntervalMs',
        baseToken: 'ViXsbD4aLa3ja5ss0jtcyPedngh',
        tables: {
          rates: 'tbl4IFfAMtykDmb2',
          competitors: 'tbl1gGQJZpUsUPE8',
          detail: 'tbl3CgYf4xmw1ZTb',
          summary: 'tblP2rZ9sKG82cHr',
        },
      },
    ],
  };
  await writeFile(file, exportFlowPackage(manifest, workflow));
  console.log(file);
} else {
  if (command !== 'preview' && command !== 'replay') {
    throw new Error(
      'Usage: competitor-sales.ts <pack|preview|replay> [file] [month for pack or product filter for run]',
    );
  }
  const { LARK_APP_ID, LARK_APP_SECRET, SELLERSPRITE_SECRET_KEY } = process.env;
  if (!LARK_APP_ID || !LARK_APP_SECRET || !SELLERSPRITE_SECRET_KEY) {
    throw new Error('Configure LARK_APP_ID, LARK_APP_SECRET and SELLERSPRITE_SECRET_KEY');
  }
  const flow = importFlowPackage(await readFile(file));
  const runner = new OpenCliRunner({
    node: process.execPath,
    openCliEntry: bundledOpenCliEntry(),
    profileDirectory: resolve('.autobot-opencli'),
    database: resolve('competitor-sales.sqlite'),
  });
  const result = await runner.run({
    ...flow,
    taskId: flow.manifest.id,
    mode: command,
    bindings: flow.manifest.inputs?.some((input) => input.key === 'productFilter')
      ? { inputs: scope ? { productFilter: scope } : {} }
      : { productFilter: scope },
    credentials: new Map([
      ['lark-app-id', { origin: 'https://open.feishu.cn', value: LARK_APP_ID }],
      ['lark-app-secret', { origin: 'https://open.feishu.cn', value: LARK_APP_SECRET }],
      [
        'sellersprite-secret-key',
        { origin: 'https://mcp.sellersprite.com', value: SELLERSPRITE_SECRET_KEY },
      ],
    ]),
  });
  console.log(JSON.stringify(result, null, 2));
}
