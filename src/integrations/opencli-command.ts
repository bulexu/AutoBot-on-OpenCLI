import type { Readable } from 'node:stream';
import { validateFlow } from '../flow/workflow.ts';
import { executeFlow } from '../runtime/execute.ts';
import { bindServices, validateServiceBindings } from '../runtime/service-bindings.ts';
import { classifyFailure, failureStep } from '../runtime/failure.ts';
import { RunStore } from '../storage/run-store.ts';

const maxRequestBytes = 4 * 1024 * 1024;

async function readRequest(input: Readable): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of input as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > maxRequestBytes) throw new Error('OpenCLI request is too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

export async function executeOpenCliCommand(input: Readable) {
  const request = await readRequest(input);
  if (
    typeof request !== 'object' ||
    request === null ||
    !('manifest' in request) ||
    !('workflow' in request) ||
    !('database' in request) ||
    typeof request.database !== 'string' ||
    !('runId' in request) ||
    typeof request.runId !== 'string' ||
    !('mode' in request) ||
    (request.mode !== 'preview' && request.mode !== 'replay') ||
    !('credentials' in request) ||
    !Array.isArray(request.credentials)
  ) {
    throw new Error('Invalid OpenCLI run request');
  }
  const credentials = new Map<string, { origin: string; value: string }>();
  for (const binding of request.credentials as unknown[]) {
    if (
      typeof binding !== 'object' ||
      binding === null ||
      !('name' in binding) ||
      typeof binding.name !== 'string' ||
      !('origin' in binding) ||
      typeof binding.origin !== 'string' ||
      !('value' in binding) ||
      typeof binding.value !== 'string' ||
      credentials.has(binding.name)
    ) {
      throw new Error('Invalid credential binding');
    }
    credentials.set(binding.name, { origin: binding.origin, value: binding.value });
  }

  const { manifest, workflow } = validateFlow(request.manifest, request.workflow);
  const bindings = validateServiceBindings('bindings' in request ? request.bindings : undefined);
  const { database, runId, mode } = request;
  const store = new RunStore(database);
  try {
    return await executeFlow(manifest, workflow, {
      ...bindServices(credentials, bindings),
      mode,
      credentials,
      savePage: (step, page, records) => store.savePage(runId, step, page, records),
    });
  } catch (error) {
    // Record the reason inside the worker so the parent can read it back even
    // though the error also travels through the envelope.
    const message = error instanceof Error ? error.message : String(error);
    const step = failureStep(error);
    if (step) {
      store.finish(runId, 'incomplete', {
        code: classifyFailure(message),
        message,
        step,
      });
    }
    throw error;
  } finally {
    store.close();
  }
}
