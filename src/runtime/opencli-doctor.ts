import { at } from '../flow/workflow.ts';

export function parseOpenCliDoctor(stdout: string) {
  const envelope: unknown = JSON.parse(stdout);
  const report = at(envelope, 'data');
  if (
    at(envelope, 'ok') !== true ||
    typeof at(report, 'daemonRunning') !== 'boolean' ||
    typeof at(report, 'extensionConnected') !== 'boolean'
  ) {
    throw new Error('OpenCLI doctor 未返回有效的诊断结果');
  }

  const text = (path: string) => {
    const value = at(report, path);
    return typeof value === 'string' ? value : undefined;
  };
  const notices = at(report, 'issues');
  const issues = Array.isArray(notices)
    ? notices.filter((issue): issue is string => typeof issue === 'string')
    : [];
  const daemonRunning = at(report, 'daemonRunning') === true;
  const daemonStale = at(report, 'daemonStale') === true;
  const extensionConnected = at(report, 'extensionConnected') === true;
  const extensionOutdated = at(report, 'extensionOutdated') === true;
  const incompatible = issues.some((issue) =>
    issue.startsWith('CLI version incompatible with extension:'),
  );
  const connectivityOk = at(report, 'connectivity.ok') === true;
  const flaky = at(report, 'daemonFlaky') === true || at(report, 'extensionFlaky') === true;
  return {
    ready:
      daemonRunning &&
      !daemonStale &&
      extensionConnected &&
      !incompatible &&
      connectivityOk &&
      !flaky,
    daemonRunning,
    daemonStale,
    daemonVersion: text('daemonVersion'),
    extensionConnected,
    extensionVersion: text('extensionVersion'),
    extensionOutdated,
    incompatible,
    connectivityOk,
    issues,
  };
}

export type BrowserDoctor = ReturnType<typeof parseOpenCliDoctor>;
