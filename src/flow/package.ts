import { unzipSync, zipSync } from 'fflate';
import { validateFlow } from './workflow.ts';

const manifestFile = 'manifest.json';
const workflowFile = 'workflow.json';
const maxFileBytes = 1024 * 1024;
const maxArchiveBytes = 2 * maxFileBytes + 4096;
const decoder = new TextDecoder('utf-8', { fatal: true });
const encoder = new TextEncoder();

function parseFile(bytes: Uint8Array, filename: string): unknown {
  try {
    return JSON.parse(decoder.decode(bytes)) as unknown;
  } catch {
    throw new Error(`Invalid JSON in ${filename}`);
  }
}

export function importFlowPackage(bytes: Uint8Array) {
  if (bytes.length < 22 || bytes.length > maxArchiveBytes) {
    throw new Error('Invalid flow package size');
  }

  const seen = new Set<string>();
  const files = unzipSync(bytes, {
    filter(entry) {
      if (entry.name !== manifestFile && entry.name !== workflowFile) {
        throw new Error('Flow package contains an unexpected entry');
      }
      if (seen.has(entry.name)) throw new Error(`Duplicate flow package entry: ${entry.name}`);
      if (entry.originalSize > maxFileBytes || entry.size > maxArchiveBytes) {
        throw new Error(`Flow package entry is too large: ${entry.name}`);
      }
      seen.add(entry.name);
      return true;
    },
  });

  if (!files[manifestFile] || !files[workflowFile]) {
    throw new Error('Flow package requires manifest.json and workflow.json');
  }
  return validateFlow(
    parseFile(files[manifestFile], manifestFile),
    parseFile(files[workflowFile], workflowFile),
  );
}

export function exportFlowPackage(manifest: unknown, workflow: unknown): Uint8Array {
  const flow = validateFlow(manifest, workflow);
  const files = {
    [manifestFile]: encoder.encode(JSON.stringify(flow.manifest, null, 2)),
    [workflowFile]: encoder.encode(JSON.stringify(flow.workflow, null, 2)),
  };
  if (Object.values(files).some((file) => file.length > maxFileBytes)) {
    throw new Error('Flow package entry is too large');
  }
  return zipSync(files);
}
