import { readFile, writeFile } from 'node:fs/promises';
import { exportFlowPackage, importFlowPackage } from '../src/flow/package.ts';

const [definitionPath, outputPath] = process.argv.slice(2);
if (!definitionPath || !outputPath?.endsWith('.flow') || process.argv.length !== 4) {
  console.error('Usage: node scripts/pack-flow.mjs <definition.json> <output.flow>');
  process.exitCode = 1;
} else {
  try {
    const { manifest, workflow } = JSON.parse(await readFile(definitionPath, 'utf8'));
    const bytes = exportFlowPackage(manifest, workflow);
    const { manifest: validated, workflow: compiled } = importFlowPackage(bytes);
    await writeFile(outputPath, bytes, { flag: 'wx' });
    console.log(`${validated.id} v${validated.version} · ${compiled.steps.length} steps · ${outputPath}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
