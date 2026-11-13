import { at } from '../flow/workflow.ts';
import type { RecordData, WriteStep } from '../flow/workflow.ts';

type TargetRecord = { recordId: string; fields: RecordData };

export type BitableTransport = {
  records: (target: string) => AsyncIterable<TargetRecord>;
  create: (target: string, records: RecordData[]) => Promise<void>;
  update: (target: string, records: TargetRecord[]) => Promise<void>;
};

export class BitableWriteError extends Error {
  confirmed: number;

  constructor(confirmed: number, cause: unknown) {
    super(`Bitable batch failed after ${confirmed} confirmed writes`, { cause });
    this.confirmed = confirmed;
  }
}

export function createBitableWriter(
  transport: BitableTransport,
  batchSize: number,
  matchKey: (row: RecordData, step: WriteStep) => unknown | Promise<unknown> = (row, step) =>
    at(row, step.key),
) {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1)
    throw new Error('Invalid Bitable batch size');

  return async (step: WriteStep, rows: RecordData[]) => {
    if (rows.length === 0) return;

    const matching = new Map<string, string>();
    const sourceKeys = await Promise.all(rows.map((row) => matchKey(row, step)));
    const keys = new Set(sourceKeys.map(String));
    for await (const record of transport.records(step.target)) {
      const key = await matchKey(record.fields, step);
      if (key == null || !keys.has(String(key))) continue;
      if (matching.has(String(key))) throw new Error('Multiple Bitable records match a source key');
      matching.set(String(key), record.recordId);
    }

    const creates: RecordData[] = [];
    const updates: TargetRecord[] = [];
    for (const [index, fields] of rows.entries()) {
      const recordId = matching.get(String(sourceKeys[index]));
      if (recordId === undefined) creates.push(fields);
      else updates.push({ recordId, fields });
    }

    let confirmed = 0;
    try {
      for (let start = 0; start < updates.length; start += batchSize) {
        const batch = updates.slice(start, start + batchSize);
        await transport.update(step.target, batch);
        confirmed += batch.length;
      }
      for (let start = 0; start < creates.length; start += batchSize) {
        const batch = creates.slice(start, start + batchSize);
        await transport.create(step.target, batch);
        confirmed += batch.length;
      }
    } catch (error) {
      throw new BitableWriteError(confirmed, error);
    }
  };
}
