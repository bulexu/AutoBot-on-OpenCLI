import assert from 'node:assert/strict';
import { test } from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { exportFlowPackage, importFlowPackage } from '../src/flow/package.ts';
import { executeFlow } from '../src/runtime/execute.ts';

const manifest = {
  schemaVersion: 1,
  id: 'competitor-sales',
  version: '1.0.0',
  endpoints: [{ method: 'GET', origin: 'https://source.example', path: '/items' }],
};

const workflow = {
  steps: [
    {
      id: 'items',
      op: 'http.read',
      url: 'https://source.example/items',
      recordsPath: 'items',
    },
    {
      id: 'detail',
      op: 'bitable.upsert',
      from: 'items',
      target: 'details',
      key: 'id',
    },
  ],
};

test('exports a v1 package that imports and runs as a read-only preview', async () => {
  const flow = importFlowPackage(exportFlowPackage(manifest, workflow));
  assert.deepEqual(flow, { manifest, workflow });
  const result = await executeFlow(flow.manifest, flow.workflow, {
    mode: 'preview',
    fetch: async () => Response.json({ items: [{ id: 'one' }] }),
    upsert: async () => assert.fail('Preview must not write'),
  });
  assert.deepEqual(result.writes[0].records, [{ id: 'one' }]);
});

test('rejects unsupported formats, missing entries and unexpected paths', () => {
  const manifestJson = strToU8(JSON.stringify(manifest));
  assert.throws(() => importFlowPackage(zipSync({ 'manifest.json': manifestJson })), /requires/);
  assert.throws(
    () => importFlowPackage(zipSync({ '../manifest.json': manifestJson })),
    /unexpected entry/,
  );
  assert.throws(
    () =>
      importFlowPackage(
        zipSync({
          'manifest.json': strToU8(JSON.stringify({ ...manifest, schemaVersion: 2 })),
          'workflow.json': strToU8(JSON.stringify(workflow)),
        }),
      ),
    /Unsupported flow schema version/,
  );
});

test('rejects oversized decompressed entries before parsing JSON', () => {
  const archive = zipSync({
    'manifest.json': new Uint8Array(1024 * 1024 + 1),
    'workflow.json': strToU8(JSON.stringify(workflow)),
  });
  assert.throws(() => importFlowPackage(archive), /entry is too large/);
});
