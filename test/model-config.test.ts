import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseModelConfig, publicModelConfig } from '../src/design/model-config.ts';

test('model settings normalize the URL and redact AK from public settings', () => {
  const config = parseModelConfig({
    base_url: 'https://model.example/v1/',
    model: ' model ',
    ak: 'key',
  });
  assert.deepEqual(config, { base_url: 'https://model.example/v1', model: 'model', ak: 'key' });
  assert.deepEqual(publicModelConfig(config), {
    base_url: 'https://model.example/v1',
    model: 'model',
    hasAk: true,
  });
});

test('changing the model keeps the saved AK for the same endpoint only', () => {
  const previous = parseModelConfig({ base_url: '', model: 'first', ak: 'key' });
  assert.equal(parseModelConfig({ base_url: '', model: 'second', ak: '' }, previous).ak, 'key');
  assert.throws(
    () =>
      parseModelConfig({ base_url: 'https://other.example/v1', model: 'second', ak: '' }, previous),
    /填写此模型地址的 AK/,
  );
});

test('model settings accept plain HTTP endpoints for local model servers', () => {
  const config = parseModelConfig({
    base_url: 'http://localhost:11434/v1',
    model: 'qwen2.5',
    ak: 'key',
  });
  assert.equal(config.base_url, 'http://localhost:11434/v1');
});

test('model settings still reject non-HTTP protocols and embedded credentials', () => {
  assert.throws(
    () => parseModelConfig({ base_url: 'ftp://model.example/v1', model: 'm', ak: 'key' }),
    /必须为 HTTP 或 HTTPS/,
  );
  assert.throws(
    () =>
      parseModelConfig({ base_url: 'https://user:pass@model.example/v1', model: 'm', ak: 'key' }),
    /不能包含凭证/,
  );
  assert.throws(
    () => parseModelConfig({ base_url: 'https://model.example/v1?key=1', model: 'm', ak: 'key' }),
    /不能包含凭证/,
  );
});
