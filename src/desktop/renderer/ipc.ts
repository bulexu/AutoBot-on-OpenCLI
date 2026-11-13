import type { BrowserDoctor } from '../../runtime/opencli-doctor.ts';
/**
 * Typed view of the `window.autobot` bridge that the preload script exposes.
 *
 * The renderer never touches `ipcRenderer` directly; every call goes through
 * this module so the shapes the UI depends on are declared in one place.
 */

export interface BindingField {
  name: string;
  label: string;
}

export interface FlowSummary {
  id: string;
  alias?: string;
  version?: string;
  credentialsSaved?: boolean;
  credentialCount?: number;
}

export interface FlowStep {
  id: string;
  op: string;
  url?: string;
  method?: string;
  target?: string;
}

export interface FlowInput {
  key: string;
  label: string;
  type: 'string' | 'number' | 'month' | 'boolean';
  min?: number;
  max?: number;
  required?: boolean;
  default?: string | number | boolean;
}

export interface FlowStatus {
  id?: string;
  alias?: string;
  version?: string;
  month?: string;
  credentialsSaved?: boolean;
  ready?: boolean;
  runtimeVersion?: string;
  competitor?: boolean;
  fields?: { credentials: BindingField[]; targets: string[] };
  steps?: FlowStep[];
  fixedTables?: Record<string, string>;
  inputs?: FlowInput[];
  inputValues?: Record<string, string | number | boolean>;
  cron?: string;
  timeZone?: string;
  flows?: FlowSummary[];
  imported?: boolean;
}

export interface RunStep {
  step_id: string;
  op: string;
  status?: string;
  rows?: number;
  target?: string | null;
  duration_ms?: number | null;
}

export interface RunRecord {
  id: string;
  task_id: string;
  mode: 'preview' | 'replay';
  status: 'running' | 'succeeded' | 'incomplete';
  started_at: string | null;
  finished_at: string | null;
  failure_code?: string | null;
  failure_message?: string | null;
  failed_step?: string | null;
  steps?: RunStep[];
}

export interface ModelConfig {
  base_url: string;
  model: string;
  hasAk: boolean;
}

export interface RuntimeStatus {
  ready: boolean;
  runtimeVersion?: string;
  browser?: BrowserDoctor;
  browserError?: string;
}

export interface DesignDraft {
  ready: boolean;
  message?: string;
  flow?: unknown;
  preview?: unknown;
}

export interface DesignResponse {
  reply: string;
  confirmPost?: boolean;
  result?: DesignDraft;
}

export interface RpaResponse {
  reply: string;
  steps: { action: string; target: string; expected: string }[];
}

export interface RunResult {
  result?: {
    writes?: { stepId: string; target: string; count: number }[];
    warnings?: string[];
  };
}

export interface AutobotApi {
  getModelConfig(): Promise<ModelConfig>;
  saveModelConfig(value: { base_url: string; model: string; ak: string }): Promise<ModelConfig>;
  sendDesignMessage(value: string): Promise<DesignResponse>;
  sendRpaMessage(value: string): Promise<RpaResponse>;
  resetDesign(mode: 'api' | 'rpa'): Promise<void>;
  runtimeStatus(diagnose?: boolean): Promise<RuntimeStatus>;
  recentRuns(): Promise<RunRecord[]>;
  taskRuns(id: string): Promise<RunRecord[]>;
  runDetail(id: string): Promise<RunRecord>;
  exportFlow(): Promise<boolean>;
  exportDesign(): Promise<boolean>;
  status(): Promise<FlowStatus>;
  importFlow(): Promise<FlowStatus>;
  selectFlow(id: string): Promise<FlowStatus>;
  saveCredentials(value: { values: string[]; bindings: unknown }): Promise<FlowStatus>;
  saveFlowPreferences(value: {
    alias: string;
    inputs: Record<string, string | number | boolean>;
    cron: string;
  }): Promise<FlowStatus>;
  onRunsChanged(callback: () => void): void;
  run(options: { mode: 'preview' | 'replay'; inputs: unknown }): Promise<RunResult>;
}

declare global {
  interface Window {
    autobot: AutobotApi;
  }
}

export const api: AutobotApi = window.autobot;
