import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateFlow } from '../flow/workflow.ts';
import { OpenCliError, runOpenCli } from '../integrations/opencli.ts';
import { RunStore } from '../storage/run-store.ts';
import type { ExecutionOptions } from './execute.ts';
import { describeProcessFailure } from './failure.ts';
import { validateServiceBindings } from './service-bindings.ts';
import type { ServiceBindings } from './service-bindings.ts';

type RunnerOptions = {
  node: string;
  openCliEntry: string;
  profileDirectory: string;
  database: string;
  nodeArgs?: string[];
  electronAsNode?: boolean;
};

type RunRequest = {
  taskId: string;
  manifest: unknown;
  workflow: unknown;
  mode: ExecutionOptions['mode'];
  credentials?: ExecutionOptions['credentials'];
  bindings?: ServiceBindings;
};

const electronBootstrap = fileURLToPath(
  new URL('../integrations/opencli-electron.mjs', import.meta.url),
);
const commandModule = new URL('../integrations/opencli-command.ts', import.meta.url).href;

export class OpenCliRunner {
  private options: RunnerOptions;
  private running = false;

  constructor(options: RunnerOptions) {
    const { node, openCliEntry, profileDirectory, database } = options;
    if (![node, openCliEntry, profileDirectory, database].every(isAbsolute))
      throw new Error('OpenCLI runner paths must be absolute');
    this.options = options;
  }

  private command(args: string[], timeoutMs: number) {
    const { node, nodeArgs, electronAsNode, openCliEntry, profileDirectory } = this.options;
    return {
      executable: node,
      args: [
        ...(nodeArgs ?? []),
        ...(electronAsNode ? [electronBootstrap] : []),
        openCliEntry,
        ...args,
      ],
      timeoutMs,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(([key]) =>
            /^(path|systemroot|windir|temp|tmp|tmpdir|lang|lc_all)$/i.test(key),
          ),
        ),
        ...(electronAsNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
        HOME: profileDirectory,
        USERPROFILE: profileDirectory,
      },
    };
  }

  async version() {
    const command = this.command(['--version'], 5000);
    return new Promise<string>((resolve, reject) => {
      execFile(
        command.executable,
        command.args,
        {
          env: command.env,
          timeout: command.timeoutMs,
          maxBuffer: 4096,
          windowsHide: true,
        },
        (error, stdout) => {
          const version = stdout.trim();
          if (error || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)) {
            reject(new Error('OpenCLI 启动检查失败'));
          } else resolve(version);
        },
      );
    });
  }

  async run(request: RunRequest) {
    if (this.running) throw new Error('Another workflow is already running');
    this.running = true;
    try {
      return await this.execute(request);
    } finally {
      this.running = false;
    }
  }

  private async execute(request: RunRequest) {
    const bindings = validateServiceBindings(request.bindings);
    const { manifest, workflow } = validateFlow(request.manifest, request.workflow);
    const { profileDirectory, database } = this.options;
    const pluginDirectory = join(profileDirectory, '.opencli', 'plugins', 'autobot');
    await mkdir(pluginDirectory, { recursive: true });
    await writeFile(join(pluginDirectory, 'package.json'), '{"type":"module"}\n');
    await writeFile(
      join(pluginDirectory, 'run.js'),
      `
import { cli } from '@jackwener/opencli/registry';
import { executeOpenCliCommand } from ${JSON.stringify(commandModule)};

cli({
  site: 'autobot',
  name: 'run',
  description: 'Execute a validated Autobot workflow',
  browser: false,
  access: 'write',
  async func() {
    try {
      return { protocol: 'autobot.v1', ok: true, data: await executeOpenCliCommand(process.stdin) };
    } catch (error) {
      // The message is the only diagnostic the desktop UI gets, so it travels
      // back inside the envelope. It never contains credential values.
      const message = error instanceof Error ? error.message : String(error);
      return {
        protocol: 'autobot.v1',
        ok: false,
        error: { code: 'WORKFLOW_FAILED', message },
      };
    }
  },
});
`,
    );

    const store = new RunStore(database);
    try {
      const runId = store.start(request.taskId, request.mode);
      let result: unknown;
      try {
        result = await runOpenCli(this.command(['autobot', 'run', '-f', 'json'], 300_000), {
          manifest,
          workflow,
          database,
          runId,
          mode: request.mode,
          bindings,
          credentials: Array.from(request.credentials ?? [], ([name, credential]) => ({
            name,
            ...credential,
          })),
        });
      } catch (error) {
        // The worker may already have recorded the reason. Read it back so the
        // parent does not overwrite a good diagnosis with a bare status.
        const recorded = store.failure(runId);
        const detail = error instanceof OpenCliError ? error.detail : undefined;
        store.finish(runId, 'incomplete', {
          code: recorded?.code ?? (error instanceof OpenCliError ? error.code : 'WORKFLOW_FAILED'),
          message: recorded?.message ?? detail ?? describeProcessFailure('WORKFLOW_FAILED'),
          step: recorded?.step,
        });
        throw new Error(`Run ${runId} failed`, { cause: error });
      }
      store.finish(runId, 'succeeded');
      return { runId, result };
    } finally {
      store.close();
    }
  }
}
