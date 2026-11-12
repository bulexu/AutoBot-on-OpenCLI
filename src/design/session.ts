import { randomUUID } from 'node:crypto';
import {
  Annotation,
  Command,
  END,
  MemorySaver,
  START,
  StateGraph,
  interrupt,
} from '@langchain/langgraph';
import { exportFlowPackage } from '../flow/package.ts';
import { endpoint, validateFlow } from '../flow/workflow.ts';
import type { Manifest, Workflow } from '../flow/workflow.ts';
import type { ExecutionOptions } from '../runtime/execute.ts';
import type { Proposal, Propose } from './model.ts';
import { parseCurl, responseShape } from './source.ts';

type Flow = { manifest: Manifest; workflow: Workflow };
type Preview = (
  flow: Flow,
  credentials: NonNullable<ExecutionOptions['credentials']>,
) => Promise<unknown>;

function compileProposal(
  source: ReturnType<typeof parseCurl>['request'],
  proposal: Proposal,
  id: string,
) {
  const method = source.method ?? 'GET';
  const url = new URL(source.url);
  const manifest = {
    id,
    schemaVersion: 1,
    version: '1.0.0',
    endpoints: [endpoint(url, method)],
  };
  const page = proposal.pagination;
  const pagination = page && {
    strategy: page.strategy,
    parameter: page.parameter,
    in: page.location,
    ...(page.hasMorePath ? { hasMorePath: page.hasMorePath } : {}),
    ...(page.strategy === 'cursor'
      ? { cursorPath: page.cursorPath }
      : {
          size: page.size,
          sizeParameter: page.sizeParameter,
          ...(page.start === null ? {} : { start: page.start }),
          ...(page.totalPath ? { totalPath: page.totalPath } : {}),
        }),
  };
  const fields = Object.fromEntries(
    proposal.fields.map((field) => [
      field.name,
      { path: field.path, ...(field.as ? { as: field.as } : {}) },
    ]),
  );
  if (
    !proposal.key ||
    !Object.hasOwn(fields, proposal.key) ||
    Object.keys(fields).length !== proposal.fields.length
  ) {
    throw new Error('草稿需要唯一字段映射及有效的写入键');
  }
  return validateFlow(manifest, {
    steps: [
      {
        ...source,
        id: 'read',
        op: 'http.read',
        recordsPath: proposal.recordsPath,
        ...(pagination ? { pagination } : {}),
      },
      { id: 'map', op: 'records.map', from: 'read', fields },
      { id: 'upsert', op: 'bitable.upsert', from: 'map', target: 'destination', key: proposal.key },
    ],
  });
}

const DesignState = Annotation.Root({
  attempts: Annotation<number>,
  proposal: Annotation<Proposal | undefined>,
  flow: Annotation<Flow | undefined>,
  preview: Annotation<unknown>,
  diagnostic: Annotation<string | undefined>,
  needsInput: Annotation<string | undefined>,
  confirmed: Annotation<boolean>,
});

export async function startDesign(
  input: { curl: string; sample: string; goal: string; readOnlyPost: boolean },
  propose: Propose,
  preview: Preview,
) {
  const { request, credentials } = parseCurl(input.curl, input.readOnlyPost);
  const response = responseShape(input.sample);
  const url = new URL(request.url);
  const modelRequest = {
    method: request.method,
    url: url.origin + url.pathname,
    queryParameters: [...url.searchParams.keys()],
    headerNames: Object.keys(request.headers ?? {}),
    body: request.body && responseShape(JSON.stringify(request.body)),
  };
  let goal = input.goal;
  if (!goal.trim() || goal.length > 4000) throw new Error('请输入同步目标');
  for (const { value } of credentials.values()) {
    for (const secret of [value, value.replace(/^Bearer\s+/i, '')]) {
      if (secret) goal = goal.replaceAll(secret, '[已隐藏]');
    }
  }

  const id = 'api-sync-' + randomUUID();
  const graph = new StateGraph(DesignState)
    .addNode('draft', async (state) => {
      const proposal = await propose({
        request: modelRequest,
        response,
        goal,
        diagnostic: state.diagnostic,
        previous: state.diagnostic ? state.proposal : undefined,
      });
      const attempts = state.attempts + 1;
      if (proposal.missing) return { attempts, needsInput: proposal.missing, flow: undefined };
      try {
        return {
          attempts,
          proposal,
          flow: compileProposal(request, proposal, id),
          diagnostic: undefined,
        };
      } catch {
        return {
          attempts,
          proposal,
          flow: undefined,
          diagnostic: '草稿的记录路径、分页参数或写入键未通过校验',
        };
      }
    })
    .addNode('trial', async (state) => {
      if (!state.flow) throw new Error('没有可试跑的草稿');
      try {
        return { preview: await preview(state.flow, credentials), diagnostic: undefined };
      } catch {
        return { diagnostic: '只读试跑失败，请检查记录路径、分页和字段映射' };
      }
    })
    .addNode('confirm', () => ({
      confirmed: interrupt<string, boolean>('确认导出当前试跑通过的草稿') === true,
    }))
    .addEdge(START, 'draft')
    .addConditionalEdges(
      'draft',
      (state) => {
        if (state.needsInput) return END;
        if (state.flow) return 'trial';
        return state.attempts < 2 ? 'draft' : END;
      },
      ['draft', 'trial', END],
    )
    .addConditionalEdges(
      'trial',
      (state) => (state.diagnostic ? (state.attempts < 2 ? 'draft' : END) : 'confirm'),
      ['draft', 'confirm', END],
    )
    .addEdge('confirm', END)
    .compile({ checkpointer: new MemorySaver() });
  const config = { configurable: { thread_id: id } };
  const state = await graph.invoke({ attempts: 0, confirmed: false }, config);
  const ready = Boolean(state.flow && (await graph.getState(config)).next.includes('confirm'));
  let confirmedPackage: Uint8Array | undefined;

  return {
    state: {
      ready,
      attempts: state.attempts,
      message: state.needsInput ?? state.diagnostic,
      flow: ready ? state.flow : undefined,
      preview: ready ? state.preview : undefined,
    },
    async confirm() {
      if (confirmedPackage) return confirmedPackage;
      if (!ready) throw new Error('仅可导出通过试跑的草稿');
      const result = await graph.invoke(new Command({ resume: true }), config);
      if (!result.confirmed || !result.flow) throw new Error('草稿尚未确认');
      confirmedPackage = exportFlowPackage(result.flow.manifest, result.flow.workflow);
      return confirmedPackage;
    },
  };
}
