import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyFailure, failureStep, tagStepFailure } from '../src/runtime/failure.ts';
import { RunStore } from '../src/storage/run-store.ts';

test('failures are classified into stable codes', () => {
  assert.equal(classifyFailure('Source API returned HTTP 401'), 'CREDENTIAL_INVALID');
  assert.equal(classifyFailure('The operation was aborted due to timeout'), 'TIMEOUT');
  assert.equal(classifyFailure('Missing binding: lark-app-secret'), 'CREDENTIAL_MISSING');
  assert.equal(classifyFailure('SellerSprite HTTP 503'), 'UPSTREAM_ERROR');
  assert.equal(classifyFailure('connect ECONNREFUSED 127.0.0.1:9410'), 'NETWORK_ERROR');
  assert.equal(classifyFailure('Duplicate source record key: id'), 'VALIDATION_ERROR');
  assert.equal(classifyFailure('something nobody predicted'), 'WORKFLOW_FAILED');
});

test('a step failure keeps the original error and tags the step', () => {
  const original = new Error('Source API returned HTTP 401');
  const tagged = tagStepFailure(original, 'monthly-sales');
  assert.equal(tagged, original);
  assert.equal(failureStep(tagged), 'monthly-sales');
  assert.equal(failureStep(new Error('plain')), undefined);
});

test('the run store keeps the reason a run stopped', () => {
  const store = new RunStore(':memory:');
  try {
    const runId = store.start('task-1', 'replay');
    store.finish(runId, 'incomplete', {
      code: 'CREDENTIAL_INVALID',
      message: 'Source API returned HTTP 401',
      step: 'items',
    });
    const run = store.recentRuns().find((item) => item.id === runId);
    assert.equal(run?.status, 'incomplete');
    assert.equal(run?.failure_code, 'CREDENTIAL_INVALID');
    assert.equal(run?.failure_message, 'Source API returned HTTP 401');
    assert.equal(run?.failed_step, 'items');
    assert.deepEqual(store.failure(runId), {
      code: 'CREDENTIAL_INVALID',
      message: 'Source API returned HTTP 401',
      step: 'items',
    });
  } finally {
    store.close();
  }
});

test('a successful run records no failure', () => {
  const store = new RunStore(':memory:');
  try {
    const runId = store.start('task-1', 'preview');
    store.finish(runId, 'succeeded');
    const run = store.recentRuns().find((item) => item.id === runId);
    assert.equal(run?.failure_code, null);
    assert.equal(store.failure(runId), undefined);
  } finally {
    store.close();
  }
});

test('the run store keeps the steps that actually ran', () => {
  const store = new RunStore(':memory:');
  try {
    const runId = store.start('task-1', 'replay');
    store.saveStep(runId, {
      seq: 0,
      stepId: 'read',
      op: 'http.read',
      status: 'succeeded',
      rows: 12,
      durationMs: 240,
    });
    store.saveStep(runId, {
      seq: 1,
      stepId: 'write',
      op: 'bitable.upsert',
      status: 'failed',
      rows: 0,
      target: 'detail-table',
      durationMs: 90,
    });
    assert.deepEqual(store.steps(runId), [
      {
        seq: 0,
        step_id: 'read',
        op: 'http.read',
        status: 'succeeded',
        rows: 12,
        target: null,
        duration_ms: 240,
      },
      {
        seq: 1,
        step_id: 'write',
        op: 'bitable.upsert',
        status: 'failed',
        rows: 0,
        target: 'detail-table',
        duration_ms: 90,
      },
    ]);
  } finally {
    store.close();
  }
});
