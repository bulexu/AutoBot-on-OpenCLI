import { setTimeout as delay } from 'node:timers/promises';

export class RetryableReadError extends Error {
  retryMs: number;
  constructor(message: string, retryMs: number) {
    super(message);
    this.retryMs = retryMs;
  }
}

export async function fetchRead(fetcher: typeof fetch, url: URL | string, init: RequestInit) {
  let response: Response;
  try {
    response = await fetcher(url, { ...init, signal: AbortSignal.timeout(30_000) });
  } catch (error) {
    if (error instanceof TypeError || (error instanceof Error && error.name === 'TimeoutError')) {
      throw new RetryableReadError('API connection failed or timed out', 750);
    }
    throw error;
  }
  if ([429, 502, 503, 504].includes(response.status)) {
    const header = response.headers.get('retry-after');
    const seconds = header === null ? NaN : Number(header);
    const wait = Number.isFinite(seconds)
      ? seconds * 1000
      : header
        ? Date.parse(header) - Date.now()
        : NaN;
    await response.body?.cancel();
    throw new RetryableReadError(
      `API returned HTTP ${response.status}`,
      Number.isFinite(wait) ? Math.max(0, wait) : response.status === 429 ? 60_000 : 750,
    );
  }
  return response;
}

export async function retryRead<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof RetryableReadError) || error.retryMs > 60_000) throw error;
    await delay(error.retryMs);
    return operation();
  }
}
