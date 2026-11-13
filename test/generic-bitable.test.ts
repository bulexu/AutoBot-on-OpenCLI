import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBitableWriter } from '../src/integrations/bitable.ts';
import { flowExpression } from '../src/flow/expression.ts';
import type { RecordData } from '../src/flow/workflow.ts';

test('generic Bitable writer awaits expression keys for both existing and incoming rows', async () => {
  const updated: unknown[] = [];
  const created: RecordData[] = [];
  const writer = createBitableWriter(
    {
      async *records() {
        yield { recordId: 'existing', fields: { month: '2026-10', product: 'A', sales: 1 } };
      },
      async create(_target, rows) {
        created.push(...rows);
      },
      async update(_target, rows) {
        updated.push(...rows);
      },
    },
    100,
    flowExpression('$string([month, product])'),
  );
  await writer({ id: 'write', op: 'bitable.upsert', from: 'items', target: 'table', key: '' }, [
    { month: '2026-10', product: 'A', sales: 2 },
    { month: '2026-10', product: 'B', sales: 3 },
  ]);
  assert.deepEqual(updated, [
    { recordId: 'existing', fields: { month: '2026-10', product: 'A', sales: 2 } },
  ]);
  assert.deepEqual(created, [{ month: '2026-10', product: 'B', sales: 3 }]);
});
