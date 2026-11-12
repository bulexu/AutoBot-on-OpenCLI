import { endpoint } from '../flow/workflow.ts';
import type { RecordData, ReadStep } from '../flow/workflow.ts';
import type { ExecutionOptions } from '../runtime/execute.ts';

type Credentials = NonNullable<ExecutionOptions['credentials']>;
type RequestTemplate = Pick<ReadStep, 'url' | 'method' | 'headers' | 'body' | 'readOnly'>;

function argumentsFromCurl(command: string) {
  const tokens = command.replace(/\\\r?\n/g, '').match(/(?:'[^']*'|"[^"]*"|[^\s'"]+)+/g) ?? [];
  if (tokens.shift() !== 'curl') throw new Error('请输入一条 cURL 请求');
  return tokens.map((token) =>
    token.replace(/'([^']*)'|"([^"]*)"/g, (_, single, double) => single ?? double),
  );
}

export function parseCurl(
  command: string,
  readOnlyPost: boolean,
): {
  request: RequestTemplate;
  credentials: Credentials;
} {
  if (command.length > 64_000) throw new Error('cURL 请求过长');
  const args = argumentsFromCurl(command);
  let method: string | undefined;
  let rawUrl: string | undefined;
  let body: RecordData | undefined;
  const headers = new Headers();
  const take = () => {
    const value = args.shift();
    if (!value) throw new Error('cURL 参数缺少值');
    return value;
  };
  while (args.length) {
    const flag = take();
    if (flag === '-X' || flag === '--request') method = take().toUpperCase();
    else if (flag === '-H' || flag === '--header') {
      const header = take();
      const split = header.indexOf(':');
      if (split < 1) throw new Error('无效的 cURL 请求头');
      headers.set(header.slice(0, split), header.slice(split + 1).trim());
    } else if (['-d', '--data', '--data-raw', '--data-binary', '--json'].includes(flag)) {
      if (body) throw new Error('仅支持单个 JSON 请求体');
      let value: unknown;
      try {
        value = JSON.parse(take());
      } catch {
        throw new Error('请求体必须是有效的 JSON 对象');
      }
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('请求体必须是 JSON 对象');
      }
      body = value as RecordData;
    } else if (flag === '-L' || flag === '--location') {
      continue;
    } else if (!rawUrl && (flag === '--url' || flag.startsWith('https://'))) {
      rawUrl = flag === '--url' ? take() : flag;
    } else {
      throw new Error('cURL 包含当前不支持的参数');
    }
  }

  method ??= body ? 'POST' : 'GET';
  if (method !== 'GET' && method !== 'POST') throw new Error('仅支持 GET 或 POST 请求');
  if (method === 'POST' && !readOnlyPost) throw new Error('请明确确认只读 POST');
  if (!rawUrl || (method === 'GET' && body)) throw new Error('请求地址或方法无效');
  const url = new URL(rawUrl);
  const { origin } = endpoint(url, method);
  const secretKey =
    /^(?:authorization|auth|token|(?:access|refresh|session)[_-]?token|(?:client|app)[_-]?secret|secret(?:[_-]?key)?|password|cookie|(?:x[_-]?)?api[_-]?key|signature|credentials?)$/i;
  function containsSecretKey(value: unknown): boolean {
    return Boolean(
      value &&
      typeof value === 'object' &&
      Object.entries(value).some(
        ([key, nested]) => secretKey.test(key) || containsSecretKey(nested),
      ),
    );
  }
  if ([...url.searchParams.keys()].some((key) => secretKey.test(key)) || containsSecretKey(body)) {
    throw new Error('请将 URL 或请求体中的鉴权凭证移至请求头');
  }

  const credentials = new Map<string, { origin: string; value: string }>();
  const sanitizedHeaders = Object.fromEntries(
    [...headers].map(([name, value]) => {
      if (name === 'content-type' || name === 'accept') return [name, value];
      const key = 'source-' + name;
      if (!/^[\w-]+$/.test(key)) throw new Error('请求头名称不支持凭证占位符');
      credentials.set(key, { origin, value });
      return [name, '{{secret.' + key + '}}'];
    }),
  );
  for (const { value } of credentials.values()) {
    if (
      value &&
      (decodeURIComponent(url.href).includes(value) || JSON.stringify(body)?.includes(value))
    ) {
      throw new Error('请求 URL 或请求体包含请求头凭证');
    }
  }

  return {
    request: {
      url: url.href,
      method,
      ...(method === 'POST' ? { readOnly: true } : {}),
      headers: sanitizedHeaders,
      ...(body ? { body } : {}),
    },
    credentials,
  };
}

export function responseShape(sample: string): unknown {
  if (sample.length > 128_000) throw new Error('响应样例过长');
  function shape(value: unknown, depth: number): unknown {
    if (depth > 24) throw new Error('响应样例嵌套过深');
    if (Array.isArray(value)) return value.slice(0, 2).map((item) => shape(item, depth + 1));
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, shape(item, depth + 1)]),
      );
    }
    if (typeof value === 'string') return '<string>';
    if (typeof value === 'number') return 0;
    return value;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(sample);
  } catch {
    throw new Error('请输入有效的 JSON 响应样例');
  }
  return shape(parsed, 0);
}
