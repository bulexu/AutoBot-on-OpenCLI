import { flowExpression } from './expression.ts';
import { validateInputs } from './inputs.ts';
import type { FlowInput } from './inputs.ts';

export function validMonth(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export type RecordData = Record<string, unknown>;

type Field =
  | { value: unknown }
  | {
      path: string;
      default?: unknown;
      as?: 'string' | 'number' | 'boolean';
      lookup?: RecordData;
    };

type PageParameter = {
  parameter: string;
  in: 'query' | 'body';
  hasMorePath?: string;
  maxPages?: number;
};
export type HttpPagination = PageParameter &
  (
    | { strategy?: 'cursor'; cursorPath: string }
    | {
        strategy: 'page' | 'offset';
        start?: number;
        size: number;
        sizeParameter: string;
        totalPath?: string;
      }
  );

type ReadStep = {
  id: string;
  op: 'http.read';
  url: string;
  method?: 'GET' | 'POST';
  readOnly?: true;
  headers?: Record<string, string>;
  body?: RecordData;
  recordsPath: string;
  from?: string;
  parameters?: { query?: Record<string, string>; body?: Record<string, string> };
  bind?: { query?: Record<string, string>; body?: Record<string, string> };
  pagination?: HttpPagination;
  responseMode?: 'exchange';
  previewInputLimit?: 'source';
  intervalParameter?: string;
  retry?: {
    path: string;
    value: string;
    waitMs: number;
    encodedPath?: string;
    decodedPath?: string;
  };
  stopOnRateLimit?: boolean;
};

type MapStep = { id: string; op: 'records.map'; from: string; fields: Record<string, Field> };
type WriteStep = {
  id: string;
  op: 'bitable.upsert';
  from: string;
  target: string;
  key: string;
  baseToken?: string;
  keyExpression?: string;
};
type BitableReadStep = {
  id: string;
  op: 'bitable.read';
  baseToken: string;
  table: string;
  view?: string;
};
type TransformStep = { id: string; op: 'records.transform'; sources: string[]; expression: string };
export type CompetitorStep = {
  id: string;
  op: 'competitor.monthly';
  tool: 'asin_sales_trend';
  month?: string;
  monthParameter?: string;
  requestIntervalParameter?: string;
  baseToken: string;
  tables: { rates: string; competitors: string; detail: string; summary: string };
};
export type BrowserStep =
  | { id: string; op: 'browser.open'; url: string }
  | { id: string; op: 'browser.title'; url: string };
type Step =
  BrowserStep | ReadStep | MapStep | WriteStep | CompetitorStep | BitableReadStep | TransformStep;

export type Workflow = { steps: Step[] };
export type Manifest = {
  schemaVersion: 1;
  inputs?: FlowInput[];
  id: string;
  version: string;
  endpoints: { method: 'GET' | 'POST'; origin: string; path: string }[];
};

function object(value: unknown, label: string): RecordData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as RecordData;
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`${label} must be a nonempty string`);
  return value;
}

export function endpoint(url: URL, method: string) {
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new Error('HTTP steps require HTTPS URLs without embedded credentials or fragments');
  }
  return { method, origin: url.origin, path: url.pathname };
}

export function assertEndpoint(manifest: Manifest, url: URL, method: string) {
  const destination = endpoint(url, method);
  if (
    !manifest.endpoints.some(
      (rule) =>
        rule.method === destination.method &&
        rule.origin === destination.origin &&
        rule.path === destination.path,
    )
  ) {
    throw new Error('HTTP endpoint is outside the flow declaration');
  }
}

function integer(value: unknown, minimum: number, label: string) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`Invalid ${label}`);
  }
}

function validatePagination(page: RecordData, method: string) {
  string(page.parameter, 'pagination parameter');
  if (page.in !== 'query' && (page.in !== 'body' || method !== 'POST')) {
    throw new Error('Invalid pagination parameter location');
  }
  if (page.hasMorePath !== undefined) string(page.hasMorePath, 'has-more path');
  if (page.maxPages !== undefined) integer(page.maxPages, 1, 'pagination page limit');
  if (page.strategy === undefined || page.strategy === 'cursor') {
    string(page.cursorPath, 'cursor path');
    if (page.totalPath !== undefined)
      throw new Error('Cursor pagination does not use a total path');
    return;
  }
  if (page.strategy !== 'page' && page.strategy !== 'offset') {
    throw new Error('Unsupported HTTP pagination strategy');
  }
  if (page.start !== undefined) integer(page.start, 0, 'pagination start');
  integer(page.size, 1, 'pagination size');
  if (string(page.sizeParameter, 'page size parameter') === page.parameter) {
    throw new Error('Pagination and size parameters must be distinct');
  }
  if (page.totalPath !== undefined) {
    string(page.totalPath, 'pagination total path');
    if (page.hasMorePath !== undefined) throw new Error('Choose one pagination stop signal');
  }
}

export function validateFlow(manifestValue: unknown, workflowValue: unknown) {
  const manifest = object(manifestValue, 'manifest');
  if (manifest.schemaVersion !== 1) throw new Error('Unsupported flow schema version');
  string(manifest.id, 'flow ID');
  string(manifest.version, 'flow version');
  if (!Array.isArray(manifest.endpoints)) throw new Error('Manifest must declare endpoints');
  for (const value of manifest.endpoints) {
    const rule = object(value, 'endpoint');
    const origin = string(rule.origin, 'endpoint origin');
    const path = string(rule.path, 'endpoint path');
    if (
      !['GET', 'POST'].includes(rule.method as string) ||
      new URL(origin).origin !== origin ||
      !path.startsWith('/') ||
      endpoint(new URL(origin + path), String(rule.method)).path !== path
    ) {
      throw new Error('Invalid endpoint declaration');
    }
  }

  const workflow = object(workflowValue, 'workflow');
  if (!Array.isArray(workflow.steps) || workflow.steps.length === 0) {
    throw new Error('Workflow must contain steps');
  }
  const inputs = validateInputs(manifest.inputs);
  const legacy = manifest.inputs === undefined;
  const outputs = new Set<string>();
  const ids = new Set<string>();
  for (const value of workflow.steps) {
    const step = object(value, 'step');
    const id = string(step.id, 'step ID');
    if (ids.has(id)) throw new Error(`Duplicate step ID: ${id}`);
    ids.add(id);
    switch (step.op) {
      case 'competitor.monthly': {
        if (step.tool !== 'asin_sales_trend') throw new Error('Unsupported competitor sales tool');
        if (workflow.steps.length !== 1) throw new Error('Monthly sales must be the sole step');
        if (
          legacy &&
          validMonth(step.month) &&
          (step.monthParameter === undefined || step.monthParameter === 'month')
        ) {
          inputs.push({
            key: 'month',
            label: '抓取月份',
            type: 'month',
            required: true,
            default: step.month,
          });
        } else if (
          !inputs.some(
            (input) =>
              input.key ===
                (step.monthParameter ?? (validMonth(step.month) ? 'month' : undefined)) &&
              input.type === 'month' &&
              (input.required || input.default !== undefined),
          )
        ) {
          throw new Error('竞品步骤需绑定已声明的月份参数');
        }
        if (
          step.requestIntervalParameter !== undefined &&
          !inputs.some(
            (input) => input.key === step.requestIntervalParameter && input.type === 'number',
          )
        ) {
          throw new Error('竞品步骤需绑定已声明的请求间隔数值参数');
        }
        string(step.baseToken, 'Feishu base token');
        const tables = object(step.tables, 'Feishu table bindings');
        const tableIds = ['rates', 'competitors', 'detail', 'summary'].map((role) =>
          string(tables[role], role),
        );
        if (new Set(tableIds).size !== tableIds.length)
          throw new Error('Table bindings must be distinct');
        assertEndpoint(manifest as Manifest, new URL('https://mcp.sellersprite.com/mcp'), 'POST');
        break;
      }
      case 'http.read': {
        const method = step.method ?? 'GET';
        if (method !== 'GET' && (method !== 'POST' || step.readOnly !== true)) {
          throw new Error('HTTP read requires GET or a declared read-only POST');
        }
        assertEndpoint(manifest as Manifest, new URL(string(step.url, 'URL')), method);
        string(step.recordsPath, 'records path');
        if (step.from !== undefined && !outputs.has(string(step.from, 'source step'))) {
          throw new Error('HTTP input requires a preceding record output');
        }
        if (step.parameters !== undefined) {
          const parameters = object(step.parameters, 'HTTP parameters');
          for (const [location, entries] of Object.entries(parameters)) {
            if (location !== 'query' && (location !== 'body' || method !== 'POST'))
              throw new Error('Invalid HTTP parameter location');
            for (const key of Object.values(object(entries, 'HTTP parameter references'))) {
              if (!inputs.some((input) => input.key === key))
                throw new Error('HTTP 参数引用未声明的流程参数');
            }
          }
        }
        if (step.bind !== undefined) {
          if (step.from === undefined) throw new Error('HTTP bindings require a source step');
          const bindings = object(step.bind, 'HTTP bindings');
          for (const [location, values] of Object.entries(bindings)) {
            if (location !== 'query' && (location !== 'body' || method !== 'POST')) {
              throw new Error('Invalid HTTP binding location');
            }
            for (const path of Object.values(object(values, 'HTTP binding paths'))) {
              string(path, 'HTTP binding path');
            }
          }
        }
        if (step.headers !== undefined) {
          for (const value of Object.values(object(step.headers, 'headers')))
            string(value, 'header value');
        }
        if (step.body !== undefined) {
          if (method !== 'POST') throw new Error('Only POST reads support a request body');
          object(step.body, 'request body');
        }
        if (step.responseMode !== undefined && (step.responseMode !== 'exchange' || !step.from))
          throw new Error('HTTP exchange requires source records');
        if (
          step.previewInputLimit !== undefined &&
          (step.previewInputLimit !== 'source' || step.responseMode !== 'exchange')
        )
          throw new Error('Preview source limit requires an HTTP exchange');
        if (
          step.intervalParameter !== undefined &&
          !inputs.some((input) => input.key === step.intervalParameter && input.type === 'number')
        )
          throw new Error('HTTP interval requires a declared numeric input');
        if (step.retry !== undefined) {
          const retry = object(step.retry, 'HTTP retry condition');
          string(retry.path, 'retry path');
          string(retry.value, 'retry value');
          if (retry.encodedPath !== undefined) string(retry.encodedPath, 'encoded response path');
          if (retry.decodedPath !== undefined) string(retry.decodedPath, 'decoded response path');
          integer(retry.waitMs, 0, 'retry wait');
          if (Number(retry.waitMs) > 60_000) throw new Error('HTTP retry wait exceeds 60 seconds');
        }
        if (step.stopOnRateLimit !== undefined && typeof step.stopOnRateLimit !== 'boolean')
          throw new Error('Invalid HTTP rate-limit policy');
        if (step.pagination !== undefined) {
          const page = object(step.pagination, 'pagination');
          validatePagination(page, method);
          if (step.responseMode === 'exchange' && page.maxPages === undefined)
            throw new Error('Paginated HTTP exchange requires a page limit');
        }
        outputs.add(id);
        break;
      }
      case 'browser.open':
      case 'browser.title':
        assertEndpoint(manifest as Manifest, new URL(string(step.url, 'Browser URL')), 'GET');
        if (step.op === 'browser.title') outputs.add(id);
        break;
      case 'bitable.read':
        string(step.baseToken, 'Feishu base token');
        string(step.table, 'Feishu table');
        if (step.view !== undefined) string(step.view, 'Feishu view');
        outputs.add(id);
        break;
      case 'records.transform':
        if (!Array.isArray(step.sources) || !step.sources.every((source) => outputs.has(source)))
          throw new Error('Transformation requires preceding record sources');
        flowExpression(string(step.expression, 'record expression'));
        outputs.add(id);
        break;
      case 'records.map':
        if (!outputs.has(string(step.from, 'source step')))
          throw new Error('Mapping requires a preceding record output');
        for (const value of Object.values(object(step.fields, 'fields'))) {
          const field = object(value, 'field mapping');
          if (Object.hasOwn(field, 'value')) continue;
          string(field.path, 'field path');
          if (field.lookup !== undefined) object(field.lookup, 'lookup');
          if (
            field.as !== undefined &&
            !['string', 'number', 'boolean'].includes(field.as as string)
          ) {
            throw new Error('Unsupported field conversion');
          }
        }
        outputs.add(id);
        break;
      case 'bitable.upsert':
        if (!outputs.has(string(step.from, 'source step')))
          throw new Error('Upsert requires a preceding record output');
        string(step.target, 'target binding');
        if (step.baseToken !== undefined) string(step.baseToken, 'Feishu base token');
        if (step.keyExpression !== undefined)
          flowExpression(string(step.keyExpression, 'record key expression'));
        else string(step.key, 'source key field');
        break;
      default:
        throw new Error(`Unsupported operator: ${String(step.op)}`);
    }
  }

  return {
    manifest: { ...manifest, ...(inputs.length ? { inputs } : {}) } as Manifest,
    workflow: workflow as Workflow,
  };
}

export function at(value: unknown, path: string): unknown {
  if (path === '$') return value;
  return path
    .replace(/^\$\./, '')
    .split('.')
    .reduce<unknown>((current, key) => {
      if (current && typeof current === 'object' && Object.hasOwn(current, key)) {
        return (current as RecordData)[key];
      }
      return undefined;
    }, value);
}

export function recordList(value: unknown): RecordData[] {
  if (!Array.isArray(value)) throw new Error('Expected an array of records');
  return value.map((row) => object(row, 'record'));
}

export function mapRecord(row: RecordData, fields: MapStep['fields']): RecordData {
  return Object.fromEntries(
    Object.entries(fields).map(([name, field]) => {
      if ('value' in field) return [name, field.value];
      let value = at(row, field.path);
      if (value != null && field.lookup) {
        const key = String(value);
        value = Object.hasOwn(field.lookup, key) ? field.lookup[key] : undefined;
      }
      value ??= field.default;
      if (value == null) return [name, value];
      if (field.as === 'string') value = String(value);
      if (field.as === 'number') {
        if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) {
          throw new Error(`Field ${name} cannot be converted to a number`);
        }
        value = Number(value);
        if (!Number.isFinite(value))
          throw new Error(`Field ${name} cannot be converted to a number`);
      }
      if (field.as === 'boolean') {
        if (value === true || value === 1 || value === '1' || value === 'true') value = true;
        else if (value === false || value === 0 || value === '0' || value === 'false')
          value = false;
        else throw new Error(`Field ${name} cannot be converted to a boolean`);
      }
      return [name, value];
    }),
  );
}

export type { BitableReadStep, ReadStep, WriteStep };
