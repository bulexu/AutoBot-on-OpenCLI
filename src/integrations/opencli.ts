import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';

export function bundledOpenCliEntry() {
  return createRequire(import.meta.url).resolve('@jackwener/opencli');
}

type Command = {
  executable: string;
  args: string[];
  timeoutMs: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

export class OpenCliError extends Error {
  code: string;
  detail: string | undefined;

  constructor(code: string, detail?: string) {
    super(`OpenCLI failed: ${code}`);
    this.code = code;
    this.detail = detail;
  }
}

function parseResult(stdout: string, failed: boolean): unknown {
  let envelope: unknown;
  try {
    envelope = JSON.parse(stdout) as unknown;
  } catch {
    throw new OpenCliError(failed ? 'PROCESS_FAILED' : 'INVALID_RESPONSE');
  }
  if (
    typeof envelope === 'object' &&
    envelope !== null &&
    'ok' in envelope &&
    envelope.ok === true &&
    'data' in envelope &&
    typeof envelope.data === 'object' &&
    envelope.data !== null &&
    'protocol' in envelope.data &&
    envelope.data.protocol === 'autobot.v1'
  ) {
    envelope = envelope.data;
  }
  if (typeof envelope !== 'object' || envelope === null || !('ok' in envelope)) {
    throw new OpenCliError('INVALID_RESPONSE');
  }
  if (envelope.ok === false && 'error' in envelope) {
    const error = envelope.error;
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof error.code === 'string' &&
      /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)
    ) {
      throw new OpenCliError(
        error.code,
        'message' in error && typeof error.message === 'string' ? error.message : undefined,
      );
    }
    throw new OpenCliError('COMMAND_FAILED');
  }
  if (!failed && envelope.ok === true && 'data' in envelope) return envelope.data;
  throw new OpenCliError(failed ? 'PROCESS_FAILED' : 'INVALID_RESPONSE');
}

export function runOpenCli(command: Command, input: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(input);
    const child = execFile(
      command.executable,
      command.args,
      {
        cwd: command.cwd,
        env: command.env,
        timeout: command.timeoutMs,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
        encoding: 'utf8',
      },
      (error, stdout) => {
        if (error?.killed) {
          reject(new OpenCliError('PROCESS_TERMINATED'));
          return;
        }
        try {
          resolve(parseResult(stdout, error !== null));
        } catch (failure) {
          reject(failure);
        }
      },
    );
    child.stdin?.on('error', () => {
      // A child that exits before reading stdin is reported by the execFile callback.
    });
    child.stdin?.end(payload);
  });
}
