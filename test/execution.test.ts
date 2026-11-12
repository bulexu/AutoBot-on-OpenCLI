import assert from 'node:assert/strict';
import { test } from 'node:test';
import { executeFlow } from '../src/runtime/execute.ts';
import { RunStore, runTask } from '../src/storage/run-store.ts';

const manifest = {
  id: 'example-sync',
  version: '1.0.0',
  schemaVersion: 1,
  endpoints: [{ method: 'GET', origin: 'https://source.example', path: '/items' }],
};

const workflow = {
  steps: [
    {
      id: 'items',
      op: 'http.read',
      url: 'https://source.example/items',
      recordsPath: 'data.rows',
      pagination: { in: 'query', parameter: 'cursor', cursorPath: 'data.next' },
    },
    {
      id: 'mapped',
      op: 'records.map',
      from: 'items',
      fields: {
        key: { path: 'id' },
        sales: { path: 'sales', as: 'number' },
        status: { path: 'state', lookup: { 2: '已成交' }, default: '待确认' },
      },
    },
    { id: 'details', op: 'bitable.upsert', from: 'mapped', target: 'detail-table', key: 'key' },
  ],
};

const fixture: typeof fetch = async (input) => {
  const url = new URL(String(input));
  const cursor = url.searchParams.get('cursor');
  if (cursor === 'second')
    return Response.json({ data: { rows: [{ id: 'B', sales: '7' }], next: null } });
  assert.equal(cursor, null);
  return Response.json({ data: { rows: [{ id: 'A', sales: '4', state: 2 }], next: 'second' } });
};

test('preview collects and maps two pages without invoking the writer', async () => {
  const store = new RunStore(':memory:');
  try {
    const result = await runTask(store, 'task-1', manifest, workflow, {
      mode: 'preview',
      fetch: fixture,
      upsert: async () => assert.fail('Preview must never call the writer'),
    });
    assert.deepEqual(result.writes[0].records, [
      { key: 'A', sales: 4, status: '已成交' },
      { key: 'B', sales: 7, status: '待确认' },
    ]);
    assert.equal(store.pages(result.runId, 'items').length, 2);
  } finally {
    store.close();
  }
});

test('a failed second page preserves the first and never reaches the writer', async () => {
  const store = new RunStore(':memory:');
  try {
    const runId = store.start('task-1', 'replay');
    await assert.rejects(
      executeFlow(manifest, workflow, {
        mode: 'replay',
        fetch: async (input) =>
          new URL(String(input)).searchParams.has('cursor')
            ? new Response(null, { status: 503 })
            : fixture(input),
        savePage: (step, page, rows) => store.savePage(runId, step, page, rows),
        upsert: async () => assert.fail('Incomplete collection must never reach the writer'),
      }),
      /503/,
    );
    store.finish(runId, 'incomplete');
    assert.deepEqual(store.pages(runId, 'items'), [{ id: 'A', sales: '4', state: 2 }]);
  } finally {
    store.close();
  }
});

test('retention shares the quota across modes and keeps other task results', () => {
  const store = new RunStore(':memory:');
  try {
    const addRun = (taskId: string, mode: 'preview' | 'replay') => {
      const runId = store.start(taskId, mode);
      store.savePage(runId, 'items', 1, [{ id: runId }]);
      store.finish(runId, mode === 'preview' ? 'succeeded' : 'incomplete');
      return runId;
    };
    const otherTask = addRun('task-2', 'preview');
    const oldest = addRun('task-1', 'preview');
    const retained = addRun('task-1', 'replay');
    for (let index = 0; index < 9; index++) addRun('task-1', 'preview');
    assert.deepEqual(store.pages(oldest, 'items'), []);
    assert.equal(store.pages(retained, 'items').length, 1);
    assert.equal(store.pages(otherTask, 'items').length, 1);
  } finally {
    store.close();
  }
});

test('an undeclared request is rejected before any fetch', async () => {
  await assert.rejects(
    executeFlow({ ...manifest, endpoints: [] }, workflow, {
      mode: 'preview',
      fetch: async () => assert.fail('Undeclared endpoint must never be called'),
    }),
    /outside the flow declaration/,
  );
});

test('replay recovers record IDs after a write succeeds but its response is lost', async () => {
  const { BitableWriteError, createBitableWriter } = await import('../src/integrations/bitable.ts');
  const records = new Map<string, Record<string, unknown>>();
  let loseResponse = true;
  const writer = createBitableWriter(
    {
      async *records() {
        for (const [recordId, fields] of records) yield { recordId, fields };
      },
      async create(_target, batch) {
        for (const fields of batch) records.set(`rec-${records.size + 1}`, fields);
        if (loseResponse && records.size === 2) {
          loseResponse = false;
          throw new Error('Lost response');
        }
      },
      async update(_target, batch) {
        for (const { recordId, fields } of batch) {
          assert.ok(records.has(recordId));
          records.set(recordId, fields);
        }
      },
    },
    1,
  );

  await assert.rejects(
    executeFlow(manifest, workflow, { mode: 'replay', fetch: fixture, upsert: writer }),
    (error: unknown) => error instanceof BitableWriteError && error.confirmed === 1,
  );
  await executeFlow(manifest, workflow, { mode: 'replay', fetch: fixture, upsert: writer });
  assert.deepEqual([...records.keys()], ['rec-1', 'rec-2']);
  assert.equal(records.get('rec-2')?.key, 'B');
});

test('generic HTTP reads can bind requests to previous output rows', async () => {
  const chained = {
    steps: [
      { id: 'list', op: 'http.read', url: 'https://source.example/items', recordsPath: '$' },
      {
        id: 'lookup',
        op: 'http.read',
        url: 'https://source.example/items',
        recordsPath: '$',
        from: 'list',
        bind: { query: { ref: 'id' } },
      },
      { id: 'write', op: 'bitable.upsert', from: 'lookup', target: 'items', key: 'id' },
    ],
  };
  const pages: number[] = [];
  const result = await executeFlow(manifest, chained, {
    mode: 'replay',
    fetch: async (input) => {
      const ref = new URL(String(input)).searchParams.get('ref');
      return Response.json(ref ? [{ id: ref, checked: true }] : [{ id: 'A' }, { id: 'B' }]);
    },
    savePage(step, page) {
      if (step === 'lookup') pages.push(page);
    },
    upsert: async (_step, rows) => {
      assert.deepEqual(rows, [
        { id: 'A', checked: true },
        { id: 'B', checked: true },
      ]);
    },
  });
  assert.deepEqual(pages, [1, 2]);
  assert.equal(result.writes[0].count, 2);
});

test('page-number pagination uses configured query fields and a nested has-more flag', async () => {
  const seen: string[][] = [];
  const result = await executeFlow(
    manifest,
    {
      steps: [
        {
          id: 'read',
          op: 'http.read',
          url: 'https://source.example/items',
          recordsPath: 'rows',
          pagination: {
            strategy: 'page',
            parameter: 'pageNo',
            in: 'query',
            start: 0,
            sizeParameter: 'pageSize',
            size: 5,
            hasMorePath: 'meta.more',
          },
        },
        { id: 'write', op: 'bitable.upsert', from: 'read', target: 'items', key: 'id' },
      ],
    },
    {
      mode: 'replay',
      fetch: async (input) => {
        const params = new URL(String(input)).searchParams;
        const page = params.get('pageNo')!;
        seen.push([page, params.get('pageSize')!]);
        return Response.json({ rows: [{ id: page }], meta: { more: page === '0' } });
      },
      upsert: async (_step, rows) => assert.deepEqual(rows, [{ id: '0' }, { id: '1' }]),
    },
  );
  assert.deepEqual(seen, [
    ['0', '5'],
    ['1', '5'],
  ]);
  assert.equal(result.writes[0].count, 2);
});

test('offset pagination uses configured POST fields and stops at the response total', async () => {
  const body: unknown[] = [];
  await executeFlow(
    {
      ...manifest,
      endpoints: [{ ...manifest.endpoints[0], method: 'POST' }],
    },
    {
      steps: [
        {
          id: 'read',
          op: 'http.read',
          method: 'POST',
          readOnly: true,
          url: 'https://source.example/items',
          body: { category: 'fixture' },
          recordsPath: 'data.items',
          pagination: {
            strategy: 'offset',
            parameter: 'skip',
            in: 'body',
            start: 2,
            sizeParameter: 'take',
            size: 3,
            totalPath: 'data.total',
          },
        },
      ],
    },
    {
      mode: 'replay',
      fetch: async (_input, init) => {
        const payload = JSON.parse(String(init?.body)) as { skip: number };
        body.push(payload);
        return Response.json({
          data: { items: [{ id: payload.skip }, { id: payload.skip + 1 }], total: 6 },
        });
      },
    },
  );
  assert.deepEqual(body, [
    { category: 'fixture', skip: 2, take: 3 },
    { category: 'fixture', skip: 4, take: 3 },
  ]);
});

test('pagination limit stops replay before write and still allows bounded preview', async () => {
  const capped = {
    steps: [
      {
        id: 'read',
        op: 'http.read',
        url: 'https://source.example/items',
        recordsPath: 'rows',
        pagination: {
          strategy: 'page',
          in: 'query',
          parameter: 'page',
          sizeParameter: 'limit',
          size: 1,
          maxPages: 2,
        },
      },
      { id: 'write', op: 'bitable.upsert', from: 'read', target: 'items', key: 'id' },
    ],
  };
  const read: typeof fetch = async (input) =>
    Response.json({ rows: [{ id: new URL(String(input)).searchParams.get('page') }] });
  await assert.rejects(
    executeFlow(manifest, capped, {
      mode: 'replay',
      fetch: read,
      upsert: async () => assert.fail('Incomplete collection must not write'),
    }),
    /exceeded its page limit/,
  );
  const preview = await executeFlow(manifest, capped, { mode: 'preview', fetch: read });
  assert.equal(preview.writes[0].count, 2);
});

test('each step reports what it produced so the run can be replayed in the UI', async () => {
  const store = new RunStore(':memory:');
  try {
    const result = await runTask(store, 'task-1', manifest, workflow, {
      mode: 'replay',
      fetch: fixture,
      upsert: async () => {},
    });
    const steps = store.steps(result.runId);
    assert.deepEqual(
      steps.map((step) => [step.step_id, step.op, step.status, step.rows]),
      [
        ['items', 'http.read', 'succeeded', 2],
        ['mapped', 'records.map', 'succeeded', 2],
        ['details', 'bitable.upsert', 'succeeded', 2],
      ],
    );
    assert.equal(steps[2].target, 'detail-table');
  } finally {
    store.close();
  }
});

test('a failing step is reported as failed and the later steps never run', async () => {
  const store = new RunStore(':memory:');
  try {
    await assert.rejects(
      runTask(store, 'task-1', manifest, workflow, {
        mode: 'replay',
        fetch: async () => new Response(null, { status: 401 }),
        upsert: async () => assert.fail('A failed read must never reach the writer'),
      }),
      /failed/,
    );
    const run = store.recentRuns()[0];
    const steps = store.steps(run.id);
    assert.deepEqual(
      steps.map((step) => [step.step_id, step.status]),
      [['items', 'failed']],
    );
    assert.equal(run.failure_code, 'CREDENTIAL_INVALID');
    assert.equal(run.failed_step, 'items');
  } finally {
    store.close();
  }
});

test('read-only calls retry rate limits without retrying a write', async () => {
  const { fetchRead, retryRead } = await import('../src/integrations/read-retry.ts');
  let requests = 0;
  const result = await retryRead(() =>
    fetchRead(
      async () => {
        requests++;
        return requests === 1
          ? new Response(null, { status: 429, headers: { 'retry-after': '0' } })
          : Response.json({ ok: true });
      },
      'https://source.example/items',
      { method: 'GET' },
    ),
  );
  assert.equal(result.ok, true);
  assert.equal(requests, 2);
});

test('manifest inputs bind generic HTTP requests with typed defaults and supplied values', async () => {
  const definition = {
    ...manifest,
    inputs: [
      { key: 'period', label: '报告期', type: 'month', required: true },
      { key: 'count', label: '数量', type: 'number', default: 4 },
      { key: 'archived', label: '归档', type: 'boolean', default: false },
    ],
  };
  const workflow = {
    steps: [
      {
        id: 'read',
        op: 'http.read',
        url: 'https://source.example/items',
        recordsPath: '$',
        parameters: { query: { month: 'period', limit: 'count', archived: 'archived' } },
      },
    ],
  };
  await executeFlow(definition, workflow, {
    mode: 'preview',
    inputs: { period: '2026-09' },
    fetch: async (url) => {
      assert.deepEqual(Object.fromEntries(new URL(String(url)).searchParams), {
        month: '2026-09',
        limit: '4',
        archived: 'false',
      });
      return Response.json([]);
    },
  });
  await assert.rejects(executeFlow(definition, workflow, { mode: 'preview' }), /请填写 报告期/);
});
