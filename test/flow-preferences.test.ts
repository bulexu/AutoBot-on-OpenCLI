import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dueOccurrence, parseFlowPreferences } from '../src/desktop/flow-preferences.ts';
import { resolveInputs } from '../src/flow/inputs.ts';
import type { FlowInput } from '../src/flow/inputs.ts';

test('cron catch-up returns only the latest missed occurrence and never repeats it', () => {
  const since = new Date(2026, 10, 12, 8, 1).getTime();
  const now = new Date(2026, 10, 12, 11, 0).getTime();
  const definitions: FlowInput[] = [{ key: 'period', label: '月份', type: 'month' }];
  const config = parseFlowPreferences(
    { alias: '月报', inputs: { period: '2026-09' }, cron: '0 * * * *' },
    definitions,
    {},
    since,
  );
  assert.equal(config.alias, '月报');
  assert.equal(dueOccurrence(config, now), now);
  assert.equal(dueOccurrence({ ...config, since: now }, now + 1000), undefined);
  assert.throws(
    () => parseFlowPreferences({ alias: '', inputs: {}, cron: '60 * * * *' }, definitions, {}),
    /Cron/,
  );
  assert.deepEqual(resolveInputs(definitions, config.inputs), { period: '2026-09' });
  assert.throws(() => resolveInputs(definitions, { period: '2026-13' }), /YYYY-MM/);
});
