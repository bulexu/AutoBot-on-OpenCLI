export async function readResponse(response: Response, requestId: unknown): Promise<unknown> {
  if (!response.headers.get('content-type')?.includes('text/event-stream')) return response.json();
  const body = await response.text();
  for (const event of body.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data) continue;
    const message: unknown = JSON.parse(data);
    if (message && typeof message === 'object' && 'id' in message && message.id === requestId)
      return message;
  }
  throw new Error('API event stream did not contain the request result');
}

export function parseJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}
