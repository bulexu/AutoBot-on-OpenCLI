import { at } from '../flow/workflow.ts';
import type { HttpPagination, RecordData } from '../flow/workflow.ts';

export function createPagination(config: HttpPagination, url: URL, body: RecordData) {
  function set(parameter: string, value: string | number) {
    if (config.in === 'query') url.searchParams.set(parameter, String(value));
    else Object.defineProperty(body, parameter, { value, enumerable: true, configurable: true });
  }

  function hasMore(response: unknown) {
    if (config.hasMorePath === undefined) return undefined;
    const value = at(response, config.hasMorePath);
    if (typeof value !== 'boolean') throw new Error('Invalid pagination has-more flag');
    return value;
  }

  if (config.strategy === 'page' || config.strategy === 'offset') {
    let position = config.start ?? (config.strategy === 'page' ? 1 : 0);
    let scanned = config.strategy === 'offset' ? position : 0;
    set(config.parameter, position);
    set(config.sizeParameter, config.size);

    return {
      limit: config.maxPages ?? 1000,
      advance(response: unknown, length: number) {
        scanned += length;
        let more = hasMore(response);
        if (config.totalPath !== undefined) {
          const total = at(response, config.totalPath);
          if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0) {
            throw new Error('Invalid pagination total');
          }
          more = scanned < total;
        }
        if (!(more ?? length >= config.size)) return false;
        if (length === 0) throw new Error('HTTP pagination did not advance');
        position += config.strategy === 'page' ? 1 : length;
        if (!Number.isSafeInteger(position)) throw new Error('Invalid next pagination position');
        set(config.parameter, position);
        return true;
      },
    };
  }

  const initial =
    config.in === 'query'
      ? url.searchParams.get(config.parameter)
      : Object.hasOwn(body, config.parameter)
        ? body[config.parameter]
        : undefined;
  const seen = new Set<string>();
  if (typeof initial === 'string' || typeof initial === 'number') seen.add(String(initial));
  const cursorPath = 'cursorPath' in config ? config.cursorPath : undefined;

  return {
    limit: config.maxPages ?? Infinity,
    advance(response: unknown) {
      const more = hasMore(response);
      if (more === false) return false;
      const cursor = cursorPath ? at(response, cursorPath) : undefined;
      if (cursor == null || cursor === '') {
        if (more) throw new Error('Missing next pagination cursor');
        return false;
      }
      if (typeof cursor !== 'string' && typeof cursor !== 'number') {
        throw new Error('Invalid pagination cursor');
      }
      const value = String(cursor);
      if (seen.has(value)) throw new Error('Pagination cursor repeated');
      seen.add(value);
      set(config.parameter, cursor);
      return true;
    },
  };
}
