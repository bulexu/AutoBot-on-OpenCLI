import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { exportFlowPackage, importFlowPackage } from '../src/flow/package.ts';
import { bundledOpenCliEntry } from '../src/integrations/opencli.ts';
import { OpenCliRunner } from '../src/runtime/opencli-runner.ts';
import { RunStore } from '../src/storage/run-store.ts';

const electronExecutable = process.env.AUTOBOT_SMOKE_ELECTRON;

test('real OpenCLI loads the plugin and persists both preview pages', async () => {
  const profileDirectory = await mkdtemp(join(tmpdir(), 'autobot-opencli-'));
  const database = join(profileDirectory, 'runs.sqlite');
  const preload = join(profileDirectory, 'mock-fetch.mjs');

  try {
    await writeFile(
      preload,
      `
      globalThis.fetch = async (input) => {
        const url = new URL(input);
        if (url.origin !== 'https://source.example') throw new Error('Unexpected request');
        const cursor = url.searchParams.get('cursor');
        return Response.json({ rows: [{ id: cursor ? 'B' : 'A' }], next: cursor ? null : 'next' });
      };
    `,
    );

    const flow = importFlowPackage(
      exportFlowPackage(
        {
          id: 'smoke',
          version: '1.0.0',
          schemaVersion: 1,
          endpoints: [{ method: 'GET', origin: 'https://source.example', path: '/items' }],
        },
        {
          steps: [
            {
              id: 'read',
              op: 'http.read',
              url: 'https://source.example/items',
              recordsPath: 'rows',
              pagination: { in: 'query', parameter: 'cursor', cursorPath: 'next' },
            },
            { id: 'write', op: 'bitable.upsert', from: 'read', target: 'details', key: 'id' },
          ],
        },
      ),
    );

    const runner = new OpenCliRunner({
      node: electronExecutable ?? process.execPath,
      electronAsNode: Boolean(electronExecutable),
      openCliEntry: bundledOpenCliEntry(),
      profileDirectory,
      database,
      nodeArgs: ['--import', preload],
    });
    assert.match(await runner.version(), /^\d+\.\d+\.\d+/);
    const { runId, result } = await runner.run({
      ...flow,
      taskId: 'smoke-task',
      mode: 'preview',
    });
    assert.deepEqual(result, {
      mode: 'preview',
      writes: [
        { stepId: 'write', target: 'details', count: 2, records: [{ id: 'A' }, { id: 'B' }] },
      ],
    });
    const store = new RunStore(database);
    try {
      assert.deepEqual(store.pages(runId, 'read'), [{ id: 'A' }, { id: 'B' }]);
    } finally {
      store.close();
    }
  } finally {
    await rm(profileDirectory, { recursive: true, force: true });
  }
});

test('a failed run records why it stopped so the desktop UI can explain it', async () => {
  const profileDirectory = await mkdtemp(join(tmpdir(), 'autobot-opencli-fail-'));
  const database = join(profileDirectory, 'runs.sqlite');
  const preload = join(profileDirectory, 'mock-fetch.mjs');

  try {
    await writeFile(
      preload,
      `
      globalThis.fetch = async () => new Response(null, { status: 401 });
    `,
    );

    const flow = importFlowPackage(
      exportFlowPackage(
        {
          id: 'smoke-fail',
          version: '1.0.0',
          schemaVersion: 1,
          endpoints: [{ method: 'GET', origin: 'https://source.example', path: '/items' }],
        },
        {
          steps: [
            {
              id: 'read',
              op: 'http.read',
              url: 'https://source.example/items',
              recordsPath: 'rows',
            },
          ],
        },
      ),
    );

    const runner = new OpenCliRunner({
      node: electronExecutable ?? process.execPath,
      electronAsNode: Boolean(electronExecutable),
      openCliEntry: bundledOpenCliEntry(),
      profileDirectory,
      database,
      nodeArgs: ['--import', preload],
    });

    await assert.rejects(
      runner.run({ ...flow, taskId: 'smoke-fail-task', mode: 'preview' }),
      /failed/,
    );

    const store = new RunStore(database);
    try {
      const run = store.recentRuns()[0];
      assert.equal(run.status, 'incomplete');
      assert.equal(run.failure_code, 'CREDENTIAL_INVALID');
      assert.match(String(run.failure_message), /401/);
      assert.equal(run.failed_step, 'read');
    } finally {
      store.close();
    }
  } finally {
    await rm(profileDirectory, { recursive: true, force: true });
  }
});
