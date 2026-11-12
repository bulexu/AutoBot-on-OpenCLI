import { assertEndpoint, at, mapRecord, recordList, validateFlow } from '../flow/workflow.ts';
import type {
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

export type ExecutionOptions = {
  competitorMonthly?: (step: CompetitorStep, options: ExecutionOptions) => Promise<WriteResult[]>;

  mode: 'preview' | 'replay';
  previewPages?: number;
  credentials?: ReadonlyMap<string, Credential>;
  fetch?: typeof fetch;
  savePage?: (stepId: string, page: number, records: RecordData[]) => void;
  upsert?: (step: WriteStep, records: RecordData[]) => Promise<void>;
};

async function readPages(
  step: ReadStep,
  manifest: Manifest,
  options: ExecutionOptions,
  input: RecordData | undefined,
  savePage: (records: RecordData[]) => void,
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
    const response = await (options.fetch ?? fetch)(url, {
      method,
      headers,
      body: method === 'POST' ? JSON.stringify(body) : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      if (response.status === 401)
        throw new Error('Source API returned 401. Check the bound credential.');
      throw new Error(`Source API returned HTTP ${response.status}`);
    }
    const data: unknown = await response.json();
    const records = recordList(at(data, step.recordsPath));
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

  const outputs = new Map<string, RecordData[]>();
  const writes = [];
  for (const step of workflow.steps) {
    // Each step is isolated so a failure names the step that stopped the run.
    try {
      if (step.op === 'competitor.monthly') {
        if (!options.competitorMonthly)
          throw new Error('Competitor flow requires configured integrations');
        writes.push(...(await options.competitorMonthly(step, options)));
        continue;
      }
      if (step.op === 'http.read') {
        const inputs = step.from ? outputs.get(step.from)! : [undefined];
        const selected = options.mode === 'preview' ? inputs.slice(0, 2) : inputs;
        const records: RecordData[] = [];
        let page = 0;
        for (const input of selected) {
          const result = await readPages(step, manifest, options, input, (rows) => {
            page++;
            options.savePage?.(step.id, page, rows);
          });
          for (const row of result) records.push(row);
        }
        outputs.set(step.id, records);
        continue;
      }
      const source = outputs.get(step.from)!;
      if (step.op === 'records.map') {
        outputs.set(
          step.id,
          source.map((row) => mapRecord(row, step.fields)),
        );
        continue;
      }

      const keys = new Set<string>();
      for (const row of source) {
        const key = at(row, step.key);
        if (
          (typeof key !== 'string' || !key.trim()) &&
          (typeof key !== 'number' || !Number.isFinite(key))
        ) {
          throw new Error(`Missing source record key: ${step.key}`);
        }
        if (keys.has(String(key))) throw new Error(`Duplicate source record key: ${step.key}`);
        keys.add(String(key));
      }
      if (options.mode === 'replay') await options.upsert!(step, source);
      writes.push({
        stepId: step.id,
        target: step.target,
        count: source.length,
        ...(options.mode === 'preview' ? { records: source } : {}),
      });
    } catch (error) {
      throw tagStepFailure(error, step.id);
    }
  }
  return { mode: options.mode, writes };
}
