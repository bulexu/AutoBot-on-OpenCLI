import { pathToFileURL } from 'node:url';

const entry = process.argv[2];
if (!entry) throw new Error('OpenCLI entry is required');

// Commander detects Electron even in Node mode. This keeps its script argument handling
// aligned with Node and with OpenCLI's own process.argv.slice(2) preprocessing.
Object.defineProperty(process, 'defaultApp', { value: true, configurable: true });
process.argv.splice(1, 2, entry);
await import(pathToFileURL(entry).href);
