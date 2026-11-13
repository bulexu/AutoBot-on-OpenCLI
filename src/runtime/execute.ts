import { setTimeout as delay } from 'node:timers/promises';
import { flowExpression } from '../flow/expression.ts';
import { parseJsonValue, readResponse } from '../integrations/http-response.ts';
import { resolveInputs } from '../flow/inputs.ts';
import type { InputValue } from '../flow/inputs.ts';
import { fetchRead, retryRead, RetryableReadError } from '../integrations/read-retry.ts';
import { assertEndpoint, at, mapRecord, recordList, validateFlow } from '../flow/workflow.ts';
import type {
  BitableReadStep,
  CompetitorStep,
  Manifest,
  ReadStep,
  RecordData,
  WriteStep,
} from '../flow/workflow.ts';

import { createPagination } from './pagination.ts';
import { tagStepFailure } from './failure.ts';

type Credential = { origin: string; value: string };

type WriteResult = { stepId: string; target: string; count: number; records?: RecordData[] };

/**
 * What a single step produced, reported as soon as it settles. The desktop UI
 * turns this into the execution pipeline map, so it is recorded per step
 * instead of being inferred from the position of the failure.
 */
export type StepOutcome = {
  seq: number;
  stepId: string;
  op: string;
  status: 'succeeded' | 'failed';
  rows: number;
  target?: string;
  durationMs: number;
};

export type ExecutionOptions = {
  competitorMonthly?: (
    step: CompetitorStep & { month: string; requestIntervalMs: number },
    options: ExecutionOptions,
  ) => Promise<WriteResult[]>;

  inputs?: Record<string, unknown>;
  mode: 'preview' | 'replay';
  previewPages?: number;
  credentials?: ReadonlyMap<string, Credential>;
  fetch?: typeof fetch;
  savePage?: (stepId: string, page: number, records: RecordData[]) => void;
  bitableRead?: (step: BitableReadStep) => Promise<RecordData[]>;
  upsert?: (
    step: WriteStep,
    records: RecordData[],
    key?: (record: RecordData) => Promise<unknown>,
  ) => Promise<void>;
  onWarning?: (message: string) => void;
  onStep?: (outcome: StepOutcome) => void;
};

async function readPages(
  step: ReadStep,
  manifest: Manifest,
  options: ExecutionOptions,
  input: RecordData | undefined,
  parameters: Record<string, InputValue>,
  savePage: (records: RecordData[]) => void,
  pace: () => Promise<void>,
) {
  const url = new URL(step.url);
  const method = step.method ?? 'GET';
  assertEndpoint(manifest, url, method);

  const headers = new Headers(step.headers);
  for (const [name, value] of headers.entries()) {
    const reference = value.match(/^\{\{secret\.([\w-]+)\}\}$/);
    if (!reference) {
      if (/^(authorization|cookie|proxy-authorization|(?:x-)?api-key|secret-key)$/i.test(name)) {
        throw new Error('Credential headers require a secret reference');
      }
      continue;
    }
    const credential = options.credentials?.get(reference[1]);
    if (!credential || credential.origin !== url.origin)
      throw new Error('Credential binding unavailable for endpoint');
    headers.set(name, credential.value);
  }

  const rows: RecordData[] = [];

  const body = { ...step.body };
  for (const [name, key] of Object.entries(step.parameters?.query ?? {})) {
    if (Object.hasOwn(parameters, key)) url.searchParams.set(name, String(parameters[key]));
  }
  for (const [name, key] of Object.entries(step.parameters?.body ?? {})) {
    if (Object.hasOwn(parameters, key))
      Object.defineProperty(body, name, {
        value: parameters[key],
        enumerable: true,
        configurable: true,
      });
  }
  for (const [name, path] of Object.entries(step.bind?.query ?? {})) {
    const value = at(input, path);
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      throw new Error(`HTTP query binding ${name} requires a scalar value`);
    }
    url.searchParams.set(name, String(value));
  }
  for (const [name, path] of Object.entries(step.bind?.body ?? {})) {
    const value = at(input, path);
    if (value === undefined) throw new Error(`HTTP body binding ${name} is missing`);
    Object.defineProperty(body, name, { value, enumerable: true, configurable: true });
  }
  if (method === 'POST' && !headers.has('content-type'))
    headers.set('content-type', 'application/json');

  const pagination = step.pagination && createPagination(step.pagination, url, body);
  const previewLimit = options.mode === 'preview' ? (options.previewPages ?? 2) : Infinity;

  for (let page = 1; ; page++) {
    const data = await retryRead(async () => {
      await pace();
      const response = await fetchRead(options.fetch ?? fetch, url, {
        method,
        headers,
        body: method === 'POST' ? JSON.stringify(body) : undefined,
        redirect: 'error',
      });
      if (!response.ok) {
        if (response.status === 401)
          throw new Error('Source API returned 401. Check the bound credential.');
        throw new Error(`Source API returned HTTP ${response.status}`);
      }
      const data = await readResponse(response, body.id);
      if (step.retry) {
        const retryValue =
          at(data, step.retry.path) ??
          (step.retry.encodedPath
            ? at(parseJsonValue(at(data, step.retry.encodedPath)), step.retry.decodedPath ?? '$')
            : undefined);
        if (retryValue === step.retry.value)
          throw new RetryableReadError('Source API rate limit', step.retry.waitMs);
      }
      return data;
    });
    const records =
      step.responseMode === 'exchange'
        ? [{ input, response: data }]
        : recordList(at(data, step.recordsPath));
    savePage(records);
    for (const record of records) rows.push(record);

    if (!pagination || !pagination.advance(data, records.length)) break;
    if (page >= previewLimit) break;
    if (page >= pagination.limit) throw new Error('HTTP pagination exceeded its page limit');
  }

  return rows;
}

export async function executeFlow(
  manifestValue: unknown,
  workflowValue: unknown,
  options: ExecutionOptions,
) {
  const { manifest, workflow } = validateFlow(manifestValue, workflowValue);
  const parameters = resolveInputs(manifest.inputs ?? [], options.inputs);
  if (
    options.mode === 'preview' &&
    options.previewPages !== undefined &&
    (!Number.isSafeInteger(options.previewPages) || options.previewPages < 1)
  ) {
    throw new Error('Preview page limit must be a positive integer');
  }
  if (
    options.mode === 'replay' &&
    !options.upsert &&
    workflow.steps.some((step) => step.op === 'bitable.upsert')
  ) {
    throw new Error('Replay requires a Bitable writer');
  }

  const warnings: string[] = [];
  options = {
    ...options,
    onWarning: (message) => {
      if (warnings.length < 100) warnings.push(message);
    },
  };
  const outputs = new Map<string, RecordData[]>();
  const writes = [];
  for (const [seq, step] of workflow.steps.entries()) {
    // Each step is isolated so a failure names the step that stopped the run,
    // and every settled step reports what it produced so the UI can draw the
    // real execution path instead of guessing it from the failure position.
    const startedAt = Date.now();
    try {
      if (step.op === 'competitor.monthly') {
        if (!options.competitorMonthly)
          throw new Error('Competitor flow requires configured integrations');
        const interval = step.requestIntervalParameter
          ? (parameters[step.requestIntervalParameter] ?? 0)
          : 0;
        if (typeof interval !== 'number' || interval < 0 || interval > 10_000)
          throw new Error('请求间隔必须在 0–10000 毫秒之间');
        const results = await options.competitorMonthly(
          {
            ...step,
            month: String(parameters[step.monthParameter ?? 'month']),
            requestIntervalMs: interval,
          },
          options,
        );
        writes.push(...results);
        options.onStep?.({
          seq,
          stepId: step.id,
          op: step.op,
          status: 'succeeded',
          rows: results.reduce((sum, result) => sum + result.count, 0),
          durationMs: Date.now() - startedAt,
        });
        continue;
      }
      if (step.op === 'bitable.read' || step.op === 'records.transform') {
        if (step.op === 'bitable.read' && !options.bitableRead)
          throw new Error('Bitable reader unavailable');
        const records =
          step.op === 'bitable.read'
            ? await options.bitableRead?.(step)
            : await flowExpression(step.expression)({
                inputs: parameters,
                mode: options.mode,
                sources: Object.fromEntries(
                  step.sources.map((source) => [source, outputs.get(source)]),
                ),
              });
        const transformed = at(records, 'records');
        if (
          step.op === 'records.transform' &&
          (!records || typeof records !== 'object' || Array.isArray(records))
        )
          throw new Error('Transformation must return a records object');
        // JSONata collapses a sequence with one item to a scalar and omits empty sequences.
        const rows =
          step.op === 'bitable.read'
            ? recordList(records)
            : recordList(
                transformed === undefined
                  ? []
                  : Array.isArray(transformed)
                    ? transformed
                    : [transformed],
              );
        const notices = step.op === 'records.transform' ? at(records, 'warnings') : undefined;
        if (Array.isArray(notices))
          for (const notice of notices) {
            if (typeof notice === 'string') options.onWarning?.(notice);
          }
        outputs.set(step.id, rows);
        if (step.op === 'records.transform') options.savePage?.(step.id, 1, rows);
        options.onStep?.({
          seq,
          stepId: step.id,
          op: step.op,
          status: 'succeeded',
          rows: rows.length,
          durationMs: Date.now() - startedAt,
        });
        continue;
      }
      if (step.op === 'http.read') {
        const inputs = step.from ? outputs.get(step.from)! : [undefined];
        const selected =
          options.mode === 'preview' && step.previewInputLimit !== 'source'
            ? inputs.slice(0, 2)
            : inputs;
        const records: RecordData[] = [];
        let page = 0;
        const interval = step.intervalParameter
          ? Number(parameters[step.intervalParameter] ?? 0)
          : 0;
        if (interval < 0 || interval > 10_000)
          throw new Error('HTTP 请求间隔必须在 0–10000 毫秒之间');
        let nextRequestAt = 0;
        let rateLimited = false;
        const pace = async () => {
          const wait = nextRequestAt - performance.now();
          if (wait > 0) await delay(Math.ceil(wait));
          nextRequestAt = performance.now() + interval;
        };
        let failures = 0;
        let lastFailure: unknown;
        for (const [index, input] of selected.entries()) {
          try {
            if (rateLimited) throw new Error('本次运行已触发限流保护');
            const result = await readPages(
              step,
              manifest,
              options,
              input,
              parameters,
              (rows) => {
                page++;
                if (!step.responseMode) options.savePage?.(step.id, page, rows);
              },
              pace,
            );
            for (const row of result) records.push(row);
          } catch (error) {
            if (!step.from) throw error;
            failures++;
            if (
              step.stopOnRateLimit &&
              error instanceof RetryableReadError &&
              /rate limit|429/.test(error.message)
            )
              rateLimited = true;
            if (step.responseMode === 'exchange') {
              records.push({ input, error: error instanceof Error ? error.message : '请求失败' });
              continue;
            }
            lastFailure = error;
            options.onWarning?.(
              `${step.id} 第 ${index + 1} 条：${error instanceof Error ? error.message : '请求失败'}`,
            );
          }
        }
        if (!step.responseMode && failures && failures === selected.length) throw lastFailure;
        outputs.set(step.id, records);
        options.onStep?.({
          seq,
          stepId: step.id,
          op: step.op,
          status: 'succeeded',
          rows: records.length,
          durationMs: Date.now() - startedAt,
        });
        continue;
      }
      const source = outputs.get(step.from)!;
      if (step.op === 'records.map') {
        const mapped = source.map((row) => mapRecord(row, step.fields));
        outputs.set(step.id, mapped);
        options.onStep?.({
          seq,
          stepId: step.id,
          op: step.op,
          status: 'succeeded',
          rows: mapped.length,
          durationMs: Date.now() - startedAt,
        });
        continue;
      }

      const keyExpression = step.keyExpression ? flowExpression(step.keyExpression) : undefined;
      const keys = new Set<string>();
      for (const row of source) {
        const key = keyExpression ? await keyExpression(row) : at(row, step.key);
        if (
          (typeof key !== 'string' || !key.trim()) &&
          (typeof key !== 'number' || !Number.isFinite(key))
        ) {
          throw new Error(`Missing source record key: ${step.key}`);
        }
        if (keys.has(String(key))) throw new Error(`Duplicate source record key: ${step.key}`);
        keys.add(String(key));
      }
      if (options.mode === 'replay') await options.upsert!(step, source, keyExpression);
      writes.push({
        stepId: step.id,
        target: step.target,
        count: source.length,
        ...(options.mode === 'preview' ? { records: source } : {}),
      });
      options.onStep?.({
        seq,
        stepId: step.id,
        op: step.op,
        status: 'succeeded',
        rows: source.length,
        target: step.target,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      options.onStep?.({
        seq,
        stepId: step.id,
        op: step.op,
        status: 'failed',
        rows: 0,
        durationMs: Date.now() - startedAt,
      });
      throw tagStepFailure(error, step.id);
    }
  }
  return { mode: options.mode, writes, ...(warnings.length ? { warnings } : {}) };
}
