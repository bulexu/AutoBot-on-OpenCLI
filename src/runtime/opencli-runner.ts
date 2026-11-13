import { executeFlow } from './execute.ts';
import { parseOpenCliDoctor } from './opencli-doctor.ts';
import { tagStepFailure } from './failure.ts';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertEndpoint, at, validateFlow } from '../flow/workflow.ts';
import { OpenCliError, runOpenCli } from '../integrations/opencli.ts';
import { RunStore } from '../storage/run-store.ts';
import type { ExecutionOptions } from './execute.ts';
import { describeProcessFailure, failureStep } from './failure.ts';
import { bindServices, validateServiceBindings } from './service-bindings.ts';
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

  async doctor() {
    const command = this.command(['doctor'], 20_000);
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        command.executable,
        command.args,
        { env: command.env, timeout: command.timeoutMs, maxBuffer: 128 * 1024, windowsHide: true },
        (error, output) => (error ? reject(error) : resolve(output)),
      );
    });
    return parseOpenCliDoctor(stdout);
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
        const paced = workflow.steps.some(
          (step) =>
            (step.op === 'competitor.monthly' && step.requestIntervalParameter) ||
            (step.op === 'http.read' && step.intervalParameter),
        );
        if (
          workflow.steps.some((step) => step.op === 'browser.open' || step.op === 'browser.title')
        ) {
          const session = 'autobot-' + runId;
          const browserCommand = (args: string[]) =>
            runOpenCli(this.command(['browser', ...args, '--session', session], 30_000), null);
          try {
            result = await executeFlow(manifest, workflow, {
              ...bindServices(request.credentials ?? new Map(), bindings),
              mode: request.mode,
              inputs: bindings.inputs ?? (bindings.month ? { month: bindings.month } : undefined),
              credentials: request.credentials,
              savePage: (step, page, rows) => store.savePage(runId, step, page, rows),
              onStep: (step) => store.saveStep(runId, step),
              browser: async (step) => {
                const response = await browserCommand(
                  step.op === 'browser.open' ? ['open', step.url] : ['state', '--diagnostics'],
                );
                const url = at(response, 'url');
                if (typeof url !== 'string') throw new Error('OpenCLI 未返回浏览器页面地址');
                assertEndpoint(manifest, new URL(url), 'GET');
                if (new URL(url).href !== new URL(step.url).href)
                  throw new Error('浏览器页面与流程声明的地址不一致');
                if (step.op === 'browser.open') return { url };
                const title = at(response, 'diagnostics.title');
                if (typeof title !== 'string') throw new Error('OpenCLI 未返回页面标题');
                return { url, title };
              },
            });
          } finally {
            await browserCommand(['close']).catch(() => undefined);
          }
        } else {
          result = await runOpenCli(
            this.command(['autobot', 'run', '-f', 'json'], paced ? 1_800_000 : 300_000),
            {
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
            },
          );
        }
      } catch (error) {
        // The worker may already have recorded the reason. Read it back so the
        // parent does not overwrite a good diagnosis with a bare status.
        const recorded = store.failure(runId);
        const detail = error instanceof OpenCliError ? error.detail : undefined;
        store.finish(runId, 'incomplete', {
          code: recorded?.code ?? (error instanceof OpenCliError ? error.code : 'WORKFLOW_FAILED'),
          message:
            recorded?.message ??
            detail ??
            (failureStep(error) && error instanceof Error ? error.message : undefined) ??
            describeProcessFailure('WORKFLOW_FAILED'),
          step: recorded?.step ?? failureStep(error),
        });
        const failed = new Error(`Run ${runId} failed`, { cause: error });
        const step = recorded?.step ?? failureStep(error);
        throw step ? tagStepFailure(failed, step) : failed;
      }
      const warnings = at(result, 'warnings');
      if (Array.isArray(warnings) && warnings.length) {
        store.finish(runId, 'incomplete', { code: 'PARTIAL_RESULT', message: warnings.join('\n') });
      } else store.finish(runId, 'succeeded');
      return { runId, result };
    } finally {
      store.close();
    }
  }
}
