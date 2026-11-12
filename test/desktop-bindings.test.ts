import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bindingFields,
  mergeDesktopBindings,
  readDesktopBindings,
} from '../src/desktop/flow-bindings.ts';

const competitorWorkflow = {
  steps: [
    {
      id: 'monthly',
      op: 'competitor.monthly' as const,
      tool: 'asin_sales_trend' as const,
      month: '2026-10',
      baseToken: 'base',
      tables: { rates: 'r', competitors: 'c', detail: 'd', summary: 's' },
    },
  ],
};

const targetWorkflow = {
  steps: [
    {
      id: 'write',
      op: 'bitable.upsert' as const,
      from: 'items',
      target: '销售明细',
      key: 'id',
    },
  ],
};

test('merging keeps saved credentials when a field is submitted empty', () => {
  const saved = { values: ['app-id', 'app-secret', 'seller-key'] };
  const merged = mergeDesktopBindings(competitorWorkflow, { values: ['app-id', '', ''] }, saved);
  assert.deepEqual(merged.values, ['app-id', 'app-secret', 'seller-key']);
  assert.equal(readDesktopBindings(competitorWorkflow, merged).credentials.size, 3);
});

test('merging prefers the newly submitted credential over the saved one', () => {
  const saved = { values: ['old-id', 'old-secret', 'old-key'] };
  const merged = mergeDesktopBindings(competitorWorkflow, { values: ['new-id', '', ''] }, saved);
  assert.deepEqual(merged.values, ['new-id', 'old-secret', 'old-key']);
});

test('merging without a saved configuration keeps blank fields blank', () => {
  const merged = mergeDesktopBindings(competitorWorkflow, { values: ['a', '', ''] }, undefined);
  assert.deepEqual(merged.values, ['a', '', '']);
  assert.throws(() => readDesktopBindings(competitorWorkflow, merged), /请填写所需凭证/);
});

test('merging keeps saved target bindings when the field is submitted empty', () => {
  const saved = {
    values: ['app-id', 'app-secret'],
    bindings: { bitable: { baseToken: 'base-token', targets: { 销售明细: 'tbl-1' } } },
  };
  const merged = mergeDesktopBindings(
    targetWorkflow,
    {
      values: ['app-id', 'app-secret'],
      bindings: { bitable: { baseToken: '', targets: { 销售明细: '' } } },
    },
    saved,
  );
  const bindings = merged.bindings as {
    bitable: { baseToken: string; targets: Record<string, string> };
  };
  assert.equal(bindings.bitable.baseToken, 'base-token');
  assert.equal(bindings.bitable.targets['销售明细'], 'tbl-1');
});

test('binding fields declare credentials per workflow', () => {
  assert.equal(bindingFields(competitorWorkflow).credentials.length, 3);
  assert.deepEqual(bindingFields(competitorWorkflow).targets, []);
  assert.deepEqual(bindingFields(targetWorkflow).targets, ['销售明细']);
});
