import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, safeStorage } from 'electron';
import { DesignConversation, RpaConversation } from '../design/conversation.ts';
import { parseModelConfig, publicModelConfig } from '../design/model-config.ts';
import { createProposer, createRpaProposer } from '../design/model.ts';
import { startDesign } from '../design/session.ts';
import { importFlowPackage } from '../flow/package.ts';
import { at } from '../flow/workflow.ts';
import { bundledOpenCliEntry } from '../integrations/opencli.ts';
import { OpenCliRunner } from '../runtime/opencli-runner.ts';
import { RunStore } from '../storage/run-store.ts';
import { bindingFields, mergeDesktopBindings, readDesktopBindings } from './flow-bindings.ts';

const directory = fileURLToPath(new URL('.', import.meta.url));
const page = join(directory, 'index.html');

function missing(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function saveFile(filename: string, bytes: Uint8Array) {
  const temporary = filename + '.tmp';
  await writeFile(temporary, bytes, { mode: 0o600 });
  await rename(temporary, filename);
}

if (!app.requestSingleInstanceLock()) app.quit();
else
  void app
    .whenReady()
    .then(async () => {
      const data = app.getPath('userData');
      const flowsDirectory = join(data, 'flows');
      const activeFile = join(data, 'active.json');
      const legacyFlowFile = join(data, 'active.flow');
      const modelFile = join(data, 'model-config.enc');

      async function loadModelConfig() {
        try {
          const encrypted = await readFile(modelFile);
          const decrypted = await safeStorage.decryptStringAsync(encrypted);
          return parseModelConfig(JSON.parse(decrypted.result));
        } catch (error) {
          if (missing(error)) return undefined;
          throw new Error('无法读取已保存的模型配置，请重新保存配置');
        }
      }
      const database = join(data, 'runs.sqlite');
      // Migrate on the main process before any worker opens the database.
      new RunStore(database).close();
      const runner = new OpenCliRunner({
        node: process.execPath,
        electronAsNode: true,
        openCliEntry: bundledOpenCliEntry(),
        profileDirectory: join(data, 'opencli'),
        database,
      });
      const runtime = runner.version().then(
        (version) => ({ ready: true, runtimeVersion: version }),
        () => ({ ready: false, runtimeVersion: undefined }),
      );

      function flowPath(id: string) {
        return join(flowsDirectory, createHash('sha256').update(id).digest('hex') + '.flow');
      }

      async function installedFlows() {
        let names: string[];
        try {
          names = await readdir(flowsDirectory);
        } catch (error) {
          if (!missing(error)) throw error;
          return [];
        }
        const flows: ReturnType<typeof importFlowPackage>[] = [];
        for (const name of names.toSorted()) {
          if (!name.endsWith('.flow')) continue;
          try {
            flows.push(importFlowPackage(await readFile(join(flowsDirectory, name))));
          } catch (error) {
            console.error('Skipping unreadable flow package:', name, error);
          }
        }
        return flows;
      }

      async function installFlow(bytes: Uint8Array) {
        const installed = importFlowPackage(bytes);
        await mkdir(flowsDirectory, { recursive: true });
        await saveFile(flowPath(installed.manifest.id), bytes);
        await saveFile(activeFile, Buffer.from(JSON.stringify({ id: installed.manifest.id })));
        return installed;
      }

      async function selectedId(flows: Awaited<ReturnType<typeof installedFlows>>) {
        let stored: unknown;
        try {
          stored = JSON.parse(await readFile(activeFile, 'utf8'));
        } catch (error) {
          if (!missing(error) && !(error instanceof SyntaxError)) throw error;
        }
        const id =
          stored && typeof stored === 'object' && 'id' in stored
            ? (stored as { id?: unknown }).id
            : undefined;
        if (typeof id === 'string' && flows.some((flow) => flow.manifest.id === id)) return id;
        return flows[0]?.manifest.id;
      }

      async function flow() {
        const flows = await installedFlows();
        const id = await selectedId(flows);
        return flows.find((item) => item.manifest.id === id);
      }

      async function migrateLegacyFlow() {
        try {
          await readdir(flowsDirectory);
          return;
        } catch (error) {
          if (!missing(error)) throw error;
        }
        try {
          await installFlow(await readFile(legacyFlowFile));
        } catch (error) {
          if (!missing(error)) throw error;
        }
      }
      await migrateLegacyFlow();

      function vaultPath(id: string) {
        return join(data, 'credentials-' + createHash('sha256').update(id).digest('hex'));
      }

      async function credentialsReady(flow: ReturnType<typeof importFlowPackage>) {
        const fields = bindingFields(flow.workflow);
        if (!fields.credentials.length && !fields.targets.length) return true;
        try {
          const encrypted = await readFile(vaultPath(flow.manifest.id));
          const saved: unknown = JSON.parse(
            (await safeStorage.decryptStringAsync(encrypted)).result,
          );
          readDesktopBindings(flow.workflow, saved);
          return true;
        } catch {
          return false;
        }
      }

      async function status() {
        const flows = await installedFlows();
        const id = await selectedId(flows);
        const active = flows.find((item) => item.manifest.id === id);
        const step = active?.workflow.steps.find((step) => step.op === 'competitor.monthly');
        const fields = active ? bindingFields(active.workflow) : undefined;
        const ready = await Promise.all(flows.map((item) => credentialsReady(item)));
        return {
          id: active?.manifest.id,
          version: active?.manifest.version,
          month: step?.month,
          credentialsSaved: active ? Boolean(ready[flows.indexOf(active)]) : false,
          ...(await runtime),
          fields,
          competitor: Boolean(step),
          steps: active?.workflow.steps.map((item) => ({
            id: item.id,
            op: item.op,
            target: item.op === 'bitable.upsert' ? item.target : undefined,
            url: item.op === 'http.read' ? item.url : undefined,
            method: item.op === 'http.read' ? (item.method ?? 'GET') : undefined,
          })),
          fixedTables: step?.tables,
          flows: flows.map((item, index) => ({
            id: item.manifest.id,
            version: item.manifest.version,
            credentialsSaved: ready[index],
            credentialCount: bindingFields(item.workflow).credentials.length,
          })),
        };
      }

      let running = false;
      let conversation = new DesignConversation();
      let rpaConversation = new RpaConversation();
      let design: Awaited<ReturnType<typeof startDesign>> | undefined;
      const window = new BrowserWindow({
        width: 1100,
        height: 790,
        minWidth: 660,
        minHeight: 580,
        backgroundColor: '#f4f5f8',
        webPreferences: {
          preload: join(directory, 'preload.cjs'),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      window.on('close', (event) => {
        if (running) event.preventDefault();
      });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event) => event.preventDefault());

      let mutationPending = false;
      function handle(channel: string, action: (value: unknown) => Promise<unknown>) {
        ipcMain.handle(channel, (event, value: unknown) => {
          if (
            event.sender !== window.webContents ||
            event.senderFrame?.url !== pathToFileURL(page).href
          ) {
            throw new Error('Unrecognized desktop request');
          }
          const readOnly = ['flow:status', 'model:get', 'runtime:status', 'runs:list'].includes(
            channel,
          );
          if (readOnly) return action(value);
          if (running || mutationPending) throw new Error('请等待当前操作结束');
          mutationPending = true;
          return action(value).finally(() => {
            mutationPending = false;
          });
        });
      }

      handle('flow:status', status);
      handle('flow:import', async () => {
        const selection = await dialog.showOpenDialog(window, {
          properties: ['openFile'],
          filters: [{ name: 'Autobot 流程', extensions: ['flow'] }],
        });
        let imported = false;
        if (!selection.canceled && selection.filePaths[0]) {
          await installFlow(await readFile(selection.filePaths[0]));
          imported = true;
        }
        return { ...(await status()), imported };
      });

      handle('flow:select', async (value) => {
        if (typeof value !== 'string') throw new Error('无效的流程');
        const flows = await installedFlows();
        if (!flows.some((item) => item.manifest.id === value)) throw new Error('流程未安装');
        await saveFile(activeFile, Buffer.from(JSON.stringify({ id: value })));
        return status();
      });

      handle('flow:save-credentials', async (value) => {
        const active = await flow();
        if (!active) throw new Error('请先导入流程');
        let saved: unknown;
        try {
          const encrypted = await readFile(vaultPath(active.manifest.id));
          saved = JSON.parse((await safeStorage.decryptStringAsync(encrypted)).result);
        } catch (error) {
          if (!missing(error)) throw error;
        }
        const merged = mergeDesktopBindings(active.workflow, value, saved);
        readDesktopBindings(active.workflow, merged);
        if (!(await safeStorage.isAsyncEncryptionAvailable()))
          throw new Error('系统凭证加密不可用');
        const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(merged));
        await saveFile(vaultPath(active.manifest.id), encrypted);
        return status();
      });

      handle('flow:run', async (value) => {
        if (!(await runtime).ready) throw new Error('OpenCLI 未就绪，请重启工作台');
        const active = await flow();
        if (!active) throw new Error('请先导入流程');
        if (
          typeof value !== 'object' ||
          value === null ||
          !('mode' in value) ||
          (value.mode !== 'preview' && value.mode !== 'replay')
        ) {
          throw new Error('运行参数无效');
        }
        if (!(await credentialsReady(active))) throw new Error('请先保存该流程的凭证');
        const fields = bindingFields(active.workflow);
        const encrypted =
          fields.credentials.length || fields.targets.length
            ? await readFile(vaultPath(active.manifest.id))
            : undefined;
        const configuration: unknown = encrypted
          ? JSON.parse((await safeStorage.decryptStringAsync(encrypted)).result)
          : { values: [] };
        const { bindings, credentials } = readDesktopBindings(active.workflow, configuration);
        if (running) throw new Error('已有流程正在运行');
        running = true;
        try {
          return await runner.run({
            ...active,
            taskId: active.manifest.id,
            mode: value.mode,
            bindings,
            credentials,
          });
        } finally {
          running = false;
        }
      });

      handle('runs:task', async (value) => {
        if (typeof value !== 'string') throw new Error('无效的任务标识');
        const store = new RunStore(database);
        try {
          return store.recentRuns().filter((run) => run.task_id === value);
        } finally {
          store.close();
        }
      });

      handle('model:get', async () => publicModelConfig(await loadModelConfig()));

      handle('model:save', async (value) => {
        if (running) throw new Error('请等待当前运行结束');
        const keepAk =
          value &&
          typeof value === 'object' &&
          'ak' in value &&
          typeof value.ak === 'string' &&
          !value.ak.trim();
        const config = parseModelConfig(value, keepAk ? await loadModelConfig() : undefined);
        if (!(await safeStorage.isAsyncEncryptionAvailable()))
          throw new Error('系统凭证加密不可用');
        await saveFile(modelFile, await safeStorage.encryptStringAsync(JSON.stringify(config)));
        return publicModelConfig(config);
      });

      handle('runtime:status', async () => runtime);

      handle('runs:list', async () => {
        const store = new RunStore(database);
        try {
          return store.recentRuns();
        } finally {
          store.close();
        }
      });

      handle('flow:export', async () => {
        const active = await flow();
        if (!active) throw new Error('请先导入流程');
        const selection = await dialog.showSaveDialog(window, {
          defaultPath: 'autobot-flow.flow',
          filters: [{ name: 'Autobot 流程', extensions: ['flow'] }],
        });
        if (selection.canceled || !selection.filePath) return false;
        await saveFile(selection.filePath, await readFile(flowPath(active.manifest.id)));
        return true;
      });

      handle('design:reset', async (mode) => {
        if (running) throw new Error('已有流程正在运行');
        if (mode === 'rpa') rpaConversation = new RpaConversation();
        else if (mode === 'api') {
          conversation = new DesignConversation();
          design = undefined;
        } else throw new Error('无效的设计模式');
      });

      handle('design:rpa-message', async (value) => {
        if (running) throw new Error('已有流程正在运行');
        if (typeof value !== 'string') throw new Error('无效的设计消息');
        running = true;
        try {
          const config = await loadModelConfig();
          if (!config) return { reply: '请先到系统设置保存模型配置，再继续设计。', steps: [] };
          return await rpaConversation.send(
            value,
            createRpaProposer({
              apiKey: config.ak,
              model: config.model,
              baseURL: config.base_url,
            }),
          );
        } finally {
          running = false;
        }
      });

      handle('design:message', async (value) => {
        if (running) throw new Error('已有流程正在运行');
        if (typeof value !== 'string') throw new Error('无效的设计消息');
        running = true;
        design = undefined;
        try {
          return await conversation.send(value, async (input) => {
            const config = await loadModelConfig();
            if (!config)
              return {
                ready: false,
                message: '设计资料已收集。请先到系统设置保存模型配置，再发一条消息继续。',
              };
            design = await startDesign(
              input,
              createProposer({ apiKey: config.ak, model: config.model, baseURL: config.base_url }),
              async (flow, credentials) => {
                const trial = await runner.run({
                  ...flow,
                  taskId: flow.manifest.id,
                  mode: 'preview',
                  credentials,
                });
                const count = at(trial.result, 'writes.0.count');
                if (typeof count !== 'number' || count < 1)
                  throw new Error('试跑未返回可验证的记录');
                return trial;
              },
            );
            return design.state;
          });
        } finally {
          running = false;
        }
      });

      handle('design:export', async () => {
        const current = design;
        if (!current?.state.ready) throw new Error('请先完成试跑');
        const selection = await dialog.showSaveDialog(window, {
          defaultPath: 'api-sync.flow',
          filters: [{ name: 'Autobot 流程', extensions: ['flow'] }],
        });
        if (selection.canceled || !selection.filePath) return false;
        await saveFile(selection.filePath, await current.confirm());
        return true;
      });

      app.on('second-instance', () => window.focus());
      app.on('window-all-closed', () => app.quit());
      await window.loadFile(page);
    })
    .catch((error: unknown) => {
      console.error('Autobot startup failed:', error);
      app.exit(1);
    });
