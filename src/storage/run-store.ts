import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { executeFlow } from '../runtime/execute.ts';
import type { ExecutionOptions } from '../runtime/execute.ts';
import { classifyFailure, failureStep } from '../runtime/failure.ts';
import type { RecordData } from '../flow/workflow.ts';

export class RunStore {
  private db: DatabaseSync;

  constructor(filename: string) {
    this.db = new DatabaseSync(filename);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS runs (
        sequence INTEGER PRIMARY KEY,
        id TEXT NOT NULL UNIQUE,
        task_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        has_result INTEGER NOT NULL DEFAULT 1,
        failure_code TEXT,
        failure_message TEXT,
        failed_step TEXT
      );
      CREATE TABLE IF NOT EXISTS run_pages (
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        step_id TEXT NOT NULL,
        page INTEGER NOT NULL,
        records TEXT NOT NULL,
        PRIMARY KEY (run_id, step_id, page)
      );
    `);
    const columns = new Set(
      this.db
        .prepare('PRAGMA table_info(runs)')
        .all()
        .map((row) => row.name),
    );
    if (!columns.has('started_at')) this.db.exec('ALTER TABLE runs ADD COLUMN started_at TEXT');
    if (!columns.has('finished_at')) this.db.exec('ALTER TABLE runs ADD COLUMN finished_at TEXT');
    if (!columns.has('failure_code')) this.db.exec('ALTER TABLE runs ADD COLUMN failure_code TEXT');
    if (!columns.has('failure_message'))
      this.db.exec('ALTER TABLE runs ADD COLUMN failure_message TEXT');
    if (!columns.has('failed_step')) this.db.exec('ALTER TABLE runs ADD COLUMN failed_step TEXT');
  }

  start(taskId: string, mode: ExecutionOptions['mode']) {
    const id = randomUUID();
    this.db
      .prepare('INSERT INTO runs (id, task_id, mode, status, started_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, taskId, mode, 'running', new Date().toISOString());
    return id;
  }

  savePage(runId: string, stepId: string, page: number, records: RecordData[]) {
    this.db
      .prepare('INSERT INTO run_pages VALUES (?, ?, ?, ?)')
      .run(runId, stepId, page, JSON.stringify(records));
  }

  finish(
    runId: string,
    status: 'succeeded' | 'incomplete',
    failure?: { code: string; message: string; step?: string },
  ) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db
        .prepare(
          'UPDATE runs SET status = ?, finished_at = ?, failure_code = ?, failure_message = ?, failed_step = ? WHERE id = ?',
        )
        .run(
          status,
          new Date().toISOString(),
          failure?.code ?? null,
          failure?.message ?? null,
          failure?.step ?? null,
          runId,
        );
      this.db
        .prepare(
          `
        UPDATE runs SET has_result = 0 WHERE sequence IN (
          SELECT sequence FROM runs
          WHERE task_id = (SELECT task_id FROM runs WHERE id = ?) AND status <> 'running'
          ORDER BY sequence DESC LIMIT -1 OFFSET 10
        ) AND has_result = 1
      `,
        )
        .run(runId);
      this.db.exec(
        'DELETE FROM run_pages WHERE run_id IN (SELECT id FROM runs WHERE has_result = 0)',
      );
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  recentRuns() {
    return this.db
      .prepare(
        `
      SELECT id, task_id, mode, status, started_at, finished_at,
             failure_code, failure_message, failed_step
      FROM runs ORDER BY sequence DESC LIMIT 30
    `,
      )
      .all();
  }

  pages(runId: string, stepId: string): RecordData[] {
    return this.db
      .prepare('SELECT records FROM run_pages WHERE run_id = ? AND step_id = ? ORDER BY page')
      .all(runId, stepId)
      .flatMap((row) => JSON.parse(String(row.records)) as RecordData[]);
  }

  /** The recorded reason a run stopped, when the worker captured one. */
  failure(runId: string) {
    const row = this.db
      .prepare('SELECT failure_code, failure_message, failed_step FROM runs WHERE id = ?')
      .get(runId) as
      | { failure_code: string | null; failure_message: string | null; failed_step: string | null }
      | undefined;
    if (!row?.failure_code) return undefined;
    return {
      code: row.failure_code,
      message: row.failure_message ?? '',
      step: row.failed_step ?? undefined,
    };
  }

  close() {
    this.db.close();
  }
}

export async function runTask(
  store: RunStore,
  taskId: string,
  manifest: unknown,
  workflow: unknown,
  options: Omit<ExecutionOptions, 'savePage'>,
) {
  const runId = store.start(taskId, options.mode);
  let result;
  try {
    result = await executeFlow(manifest, workflow, {
      ...options,
      savePage: (stepId, page, records) => store.savePage(runId, stepId, page, records),
    });
  } catch (error) {
    store.finish(runId, 'incomplete', {
      code: classifyFailure(error instanceof Error ? error.message : String(error)),
      message: error instanceof Error ? error.message : String(error),
      step: failureStep(error),
    });
    throw new Error(`Run ${runId} failed`, { cause: error });
  }
  store.finish(runId, 'succeeded');
  return { runId, ...result };
}
