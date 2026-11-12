import assert from 'node:assert/strict';
import { test } from 'node:test';
import { importFlowPackage } from '../src/flow/package.ts';
import { executeFlow } from '../src/runtime/execute.ts';
import { startDesign } from '../src/design/session.ts';
import type { Proposal } from '../src/design/model.ts';

const source = {
  curl: "curl 'https://source.example/items?region=private-region' -H 'Authorization: Bearer private-key'",
  sample: '{"items":[{"id":"private-id","quantity":4}]}',
  goal: '按编号同步数量，勿泄露 private-key',
  readOnlyPost: false,
};

const proposal: Proposal = {
  missing: null,
  recordsPath: 'items',
  pagination: null,
  fields: [
    { name: '编号', path: 'id', as: null },
    { name: '数量', path: 'quantity', as: 'number' },
  ],
  key: '编号',
};

test('AI design keeps data local, retries once, and exports the confirmed previewed flow', async () => {
  let previews = 0;
  const draft = await startDesign(
    source,
    async (input) => {
      assert.doesNotMatch(JSON.stringify(input), /private-(key|id|region)/);
      assert.equal(Boolean(input.diagnostic), previews === 1);
      return proposal;
    },
    async ({ manifest, workflow }, credentials) => {
      previews++;
      if (previews === 1) throw new Error('internal details');
      return executeFlow(manifest, workflow, {
        mode: 'preview',
        credentials,
        fetch: async (url, options) => {
          assert.equal(new URL(String(url)).searchParams.get('region'), 'private-region');
          assert.equal(new Headers(options?.headers).get('authorization'), 'Bearer private-key');
          return Response.json({ items: [{ id: 'one', quantity: 4 }] });
        },
        upsert: async () => assert.fail('Design preview must not write'),
      });
    },
  );
  assert.equal(draft.state.ready, true);
  assert.equal(draft.state.attempts, 2);
  const flow = importFlowPackage(await draft.confirm());
  assert.deepEqual(flow, draft.state.flow);
  assert.match(JSON.stringify(flow), /secret.source-authorization/);
  assert.doesNotMatch(JSON.stringify(flow), /private-key/);
});

test('a draft without evidence or without a passing preview cannot export', async () => {
  const missing = await startDesign(
    source,
    async () => ({ ...proposal, missing: '请补充游标规则' }),
    async () => assert.fail('Incomplete input must not run'),
  );
  assert.equal(missing.state.attempts, 1);
  assert.equal(missing.state.ready, false);
  await assert.rejects(missing.confirm(), /仅可导出/);

  const failing = await startDesign(
    source,
    async () => proposal,
    async () => {
      throw new Error('bad response');
    },
  );
  assert.equal(failing.state.attempts, 2);
  assert.equal(failing.state.ready, false);
  await assert.rejects(failing.confirm(), /仅可导出/);
});

test('AI design cannot trial a POST without the developer marking it read-only', async () => {
  await assert.rejects(
    startDesign(
      { ...source, curl: "curl 'https://source.example/items' -d '{}'" },
      async () => assert.fail('Unconfirmed POST must not reach model'),
      async () => assert.fail('Unconfirmed POST must not run'),
    ),
    /只读/,
  );
});

test('LangChain requests a typed proposal from an OpenAI-compatible model', async (t) => {
  const { createProposer } = await import('../src/design/model.ts');
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    assert.match(String(input), /model\.example\/v1\/chat\/completions/);
    const request = JSON.parse(String(init?.body)) as { tools: { function: { name: string } }[] };
    assert.equal(request.tools[0].function.name, 'design_flow');
    return Response.json({
      id: 'fixture',
      object: 'chat.completion',
      model: 'fixture',
      choices: [
        {
          index: 0,
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_fixture',
                type: 'function',
                function: { name: 'design_flow', arguments: JSON.stringify(proposal) },
              },
            ],
          },
        },
      ],
    });
  });
  const propose = createProposer({
    apiKey: 'fixture',
    model: 'fixture',
    baseURL: 'https://model.example/v1',
  });
  assert.deepEqual(await propose({ request: {}, response: {}, goal: '同步' }), proposal);
});

test('an exported AI flow can bind its request headers and destination locally', async () => {
  const { bindingFields, readDesktopBindings } = await import('../src/desktop/flow-bindings.ts');
  const draft = await startDesign(
    source,
    async () => proposal,
    async () => ({ count: 1 }),
  );
  const { workflow } = importFlowPackage(await draft.confirm());
  assert.deepEqual(bindingFields(workflow).targets, ['destination']);
  const { credentials, bindings } = readDesktopBindings(workflow, {
    values: ['Bearer recipient-secret', 'app-id', 'app-secret'],
    bindings: { bitable: { baseToken: 'base', targets: { destination: 'table' } } },
  });
  assert.deepEqual(credentials.get('source-authorization'), {
    origin: 'https://source.example',
    value: 'Bearer recipient-secret',
  });
  assert.equal(bindings.bitable?.targets.destination, 'table');
});

test('design conversation collects API materials across turns and asks for POST confirmation', async () => {
  const { DesignConversation } = await import('../src/design/conversation.ts');
  const chat = new DesignConversation();
  let calls = 0;
  const design = async (input: {
    curl: string;
    sample: string;
    goal: string;
    readOnlyPost: boolean;
  }) => {
    calls++;
    assert.match(input.goal, /订单/);
    assert.match(input.curl, /--request POST/);
    assert.match(input.sample, /items/);
    assert.equal(input.readOnlyPost, true);
    return { ready: true };
  };
  assert.match((await chat.send('把订单同步到飞书', design)).reply, /cURL/);
  const question = await chat.send('curl https://source.example/orders --request POST', design);
  assert.equal(question.confirmPost, true);
  await chat.send('{"items":[{"id":"one"}]}', design);
  assert.equal(calls, 0);
  assert.equal((await chat.send('确认只读 POST', design)).result?.ready, true);
  assert.equal(calls, 1);
});

test('RPA design asks for clarification and carries the reply into the next turn', async () => {
  const { RpaConversation } = await import('../src/design/conversation.ts');
  const chat = new RpaConversation();
  const question = await chat.send('导出订单列表', async (turns) => {
    assert.equal(turns.length, 1);
    return { reply: '订单列表在哪个页面？', steps: [] };
  });
  assert.equal(question.steps.length, 0);
  const draft = await chat.send('后台的订单页', async (turns) => {
    assert.deepEqual(turns[1], { role: 'assistant', text: question.reply });
    return {
      reply: '已整理操作步骤',
      steps: [{ action: '点击', target: '导出', expected: '下载文件' }],
    };
  });
  assert.equal(draft.steps[0].action, '点击');
  await assert.rejects(
    chat.send('密码：test-password', async () => assert.fail('Credential reached model')),
    /移除凭证/,
  );
});
