import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OpenCliError, runOpenCli } from '../src/integrations/opencli.ts';

test('passes the request over stdin and reads the command result', async () => {
  const result = await runOpenCli(
    {
      executable: process.execPath,
      args: [
        '--input-type=module',
        '-e',
        `
      let input = '';
      for await (const chunk of process.stdin) input += chunk;
      const { runId } = JSON.parse(input);
      console.log(JSON.stringify({ ok: true, data: { runId } }));
    `,
      ],
      timeoutMs: 5000,
    },
    { runId: 'run-1', credentials: { token: 'fixture-secret' } },
  );
  assert.deepEqual(result, { runId: 'run-1' });
});

test('returns a structured failure code without surfacing stderr or remote error details', async () => {
  await assert.rejects(
    runOpenCli(
      {
        executable: process.execPath,
        args: [
          '-e',
          `
      console.error('fixture-secret');
      console.log(JSON.stringify({ ok: false, error: { code: 'AUTH_FAILED', message: 'fixture-secret' } }));
      process.exitCode = 1;
    `,
        ],
        timeoutMs: 5000,
      },
      {},
    ),
    (error: unknown) =>
      error instanceof OpenCliError &&
      error.code === 'AUTH_FAILED' &&
      !error.message.includes('fixture-secret'),
  );
});
