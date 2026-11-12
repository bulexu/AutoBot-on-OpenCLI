const api = window.autobot;
const element = (id) => document.getElementById(id);
const tabs = ['dashboard', 'flows', 'workbench', 'settings'];
const labels = { running: '运行中', succeeded: '成功', incomplete: '未完成' };
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' });
const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });
const firstMessage = '你希望自动化什么任务？可以直接描述目标，或把 cURL 和脱敏响应样例发给我。';
const opLabels = {
  'competitor.monthly': '竞品月销量抓取',
  'http.read': 'HTTP 读取',
  'records.map': '字段映射',
  'bitable.upsert': '写入目标表',
};

let selectedTab = 'dashboard';
let flow = {};
let runtime;
let busy = false;
let modelConfigured = false;
let draft;
let mode;
let awaitingPost = false;
let bindingSignature;
let runs = [];
let statusFilter = 'all';
let searchTerm = '';
let flowTab = 'overview';
const rpaFirstMessage =
  '请描述你希望在浏览器中完成的操作，以及怎样判断成功。请勿提供密码、Cookie 或验证码。草案的执行验证将在 P3 接入。';
const threads = {
  api: [{ role: 'agent', text: firstMessage }],
  rpa: [{ role: 'agent', text: rpaFirstMessage }],
};
let rpaSteps = [];

function selectTab(name, focus = false) {
  selectedTab = name;
  for (const tab of tabs) {
    const button = element('tab-' + tab);
    button.setAttribute('aria-selected', String(tab === name));
    button.tabIndex = tab === name ? 0 : -1;
    element(tab).hidden = tab !== name;
  }
  if (focus) element('tab-' + name).focus();
  if (name === 'dashboard') void refreshRuns();
  if (name === 'flows' && flow.id) void refreshFlowHistory();
}

for (const tab of tabs) {
  element('tab-' + tab).addEventListener('click', () => selectTab(tab));
  element('tab-' + tab).addEventListener('keydown', (event) => {
    const index = tabs.indexOf(tab);
    const next = {
      ArrowLeft: tabs[(index + tabs.length - 1) % tabs.length],
      ArrowRight: tabs[(index + 1) % tabs.length],
      Home: tabs[0],
      End: tabs[tabs.length - 1],
    }[event.key];
    if (!next) return;
    event.preventDefault();
    selectTab(next, true);
  });
}

async function perform(action, feedback, pending) {
  if (busy) return;
  busy = true;
  feedback.textContent = pending;
  refresh();
  try {
    await action();
  } catch (error) {
    feedback.textContent = error.message;
  } finally {
    busy = false;
    refresh();
  }
}

function renderBindingFields() {
  const signature = JSON.stringify([flow.id, flow.fields]);
  if (signature === bindingSignature) return;
  bindingSignature = signature;
  function add(container, label, name, type) {
    const field = document.createElement('label');
    const input = document.createElement('input');
    input.name = name;
    input.type = type;
    input.required = true;
    if (type === 'password' && flow.credentialsSaved) input.placeholder = '已配置，留空保留当前值';
    field.append(label, input);
    container.append(field);
  }
  const credentials = element('binding-fields');
  const targets = element('target-fields');
  credentials.replaceChildren();
  targets.replaceChildren();
  for (const field of flow.fields?.credentials ?? [])
    add(credentials, field.label, 'credential', 'password');
  const names = flow.fields?.targets ?? [];
  element('target-bindings').hidden = !names.length;
  if (names.length) {
    add(targets, '飞书多维表格 Token', 'baseToken', 'text');
    for (const target of names) add(targets, '目标表 · ' + target, 'target-' + target, 'text');
  }
  const count = element('credential-count');
  count.hidden = !(flow.fields?.credentials.length || names.length);
  count.textContent = String((flow.fields?.credentials.length ?? 0) + names.length);
}

function renderFlowList() {
  const installed = flow.flows ?? [];
  element('flow-list').replaceChildren(
    ...installed.map((item) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'flow-option';
      option.dataset.active = String(item.id === flow.id);
      const text = document.createElement('span');
      text.className = 'flow-option-text';
      const name = document.createElement('span');
      name.className = 'flow-option-name';
      name.textContent = item.id;
      name.title = item.id;
      const meta = document.createElement('span');
      meta.className = 'muted';
      meta.textContent = [
        item.version ? 'v' + item.version : '',
        item.credentialCount ? item.credentialCount + ' 项凭证' : '无需凭证',
      ]
        .filter(Boolean)
        .join(' · ');
      text.append(name, meta);
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.dataset.state = item.credentialsSaved ? 'ready' : 'pending';
      badge.textContent = item.credentialsSaved ? '已配置' : '待配置';
      option.append(text, badge);
      option.addEventListener('click', () => void switchFlow(item.id));
      return option;
    }),
  );
  element('flow-list-empty').hidden = installed.length > 0;
  element('flow-count').textContent = '已安装 ' + installed.length + ' 个流程';
}

function renderFlowMetadata() {
  const steps = flow.steps ?? [];
  element('flow-steps').replaceChildren();
  if (!steps.length) return;
  const heading = document.createElement('h3');
  heading.className = 'metadata-title';
  heading.textContent = '执行步骤';
  const list = document.createElement('ol');
  list.className = 'step-list';
  for (const [index, step] of steps.entries()) {
    const item = document.createElement('li');
    const order = document.createElement('span');
    order.className = 'step-order';
    order.textContent = String(index + 1);
    const text = document.createElement('span');
    text.className = 'step-text';
    const name = document.createElement('strong');
    name.textContent = opLabels[step.op] ?? step.op;
    const detail = document.createElement('span');
    detail.className = 'muted';
    const parts = [];
    if (step.url) parts.push((step.method ?? 'GET') + ' ' + step.url);
    if (step.target) parts.push('目标表 · ' + step.target);
    if (!parts.length) parts.push(step.id);
    detail.textContent = parts.join(' · ');
    text.append(name, detail);
    item.append(order, text);
    list.append(item);
  }
  element('flow-steps').append(heading, list);

  const tables = flow.fixedTables;
  element('fixed-tables').replaceChildren();
  if (!tables) return;
  const tableHeading = document.createElement('h3');
  tableHeading.className = 'metadata-title';
  tableHeading.textContent = '固定目标表（来自流程定义，只读）';
  const tables_ = document.createElement('ul');
  tables_.className = 'table-list';
  for (const [role, id] of Object.entries(tables)) {
    const item = document.createElement('li');
    const label = document.createElement('span');
    label.className = 'muted';
    label.textContent =
      { rates: '站点汇率', competitors: '竞品监控', detail: '销售明细', summary: '销售汇总' }[
        role
      ] ?? role;
    const value = document.createElement('code');
    value.textContent = id;
    item.append(label, value);
    tables_.append(item);
  }
  element('fixed-tables').append(tableHeading, tables_);
}

function defaultStatus() {
  return flow.id && !flow.credentialsSaved ? '请先在「凭证」中保存所需凭证后再运行。' : '';
}

function refresh() {
  renderBindingFields();
  renderFlowList();
  renderFlowMetadata();
  const hasFlow = Boolean(flow.id);
  element('flow').textContent = flow.id ?? '尚未安装流程';
  element('flow-meta').textContent = hasFlow
    ? [flow.version ? 'v' + flow.version : '', flow.month].filter(Boolean).join(' · ')
    : '导入流程包后可在此配置并运行。';
  const signal = element('runtime');
  signal.dataset.state = runtime ? (runtime.ready ? 'ready' : 'failed') : 'checking';
  const runtimeText = runtime?.ready ? '已就绪' : runtime ? '未就绪' : '检查中';
  element('runtime-label').textContent = runtimeText;
  signal.title = ['OpenCLI', runtime?.runtimeVersion, runtimeText].filter(Boolean).join(' ');
  signal.setAttribute('aria-label', signal.title);
  element('runtime-detail').textContent = runtime?.ready
    ? 'OpenCLI 已就绪（版本 ' + runtime.runtimeVersion + '），可以执行工作流。'
    : runtime
      ? 'OpenCLI 未就绪，请重启工作台后重试。'
      : '正在检查 OpenCLI…';
  element('preview').hidden = element('run').hidden = !hasFlow;
  element('preview').disabled = element('run').disabled =
    busy || !runtime?.ready || !hasFlow || !flow.credentialsSaved;
  element('flow-import-again').disabled = busy;
  element('flow-export').disabled = busy || !hasFlow;
  const hasBindings =
    element('binding-fields').childElementCount + element('target-fields').childElementCount > 0;
  element('flow-bindings').hidden = !hasBindings;
  element('binding-state').textContent = flow.credentialsSaved ? '已配置' : '待配置';
  element('save').disabled = busy || !hasBindings;
  element('model-save').disabled = busy;
  element('refresh-runs').disabled = busy;

  element('draft-card').hidden = !draft?.ready;
  element('design-export').disabled = busy || !draft?.ready;
  element('review-draft').hidden = !draft?.ready || mode !== 'api';
  element('design-result').hidden = !draft?.ready || mode !== 'api';
  element('mode-select').hidden = Boolean(mode);
  element('chat').hidden = !mode;
  element('chat-reset').hidden = !mode;
  element('chat-reset').disabled = busy;
  element('mode-back').disabled = busy;
  element('chat-mode').textContent = mode === 'rpa' ? 'RPA 设计' : 'API 设计';
  element('chat-form').hidden = !mode;
  element('rpa-result').hidden = mode !== 'rpa' || !rpaSteps.length;
  element('chat-send').disabled = busy;
  element('confirm-post').hidden = mode !== 'api' || !awaitingPost;
  element('confirm-post').disabled = busy;
  element('chat-settings').hidden = !mode || modelConfigured;
}

function formatDuration(startedAt, finishedAt) {
  if (!startedAt) return '—';
  if (!finishedAt) return '进行中';
  const milliseconds = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '—';
  return formatSpan(milliseconds);
}

function formatSpan(milliseconds) {
  if (milliseconds < 1000) return '不足 1 秒';
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 60) return seconds + ' 秒';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + ' 分 ' + (seconds % 60) + ' 秒';
  return Math.floor(minutes / 60) + ' 时 ' + (minutes % 60) + ' 分';
}

function formatElapsed(startedAt) {
  if (!startedAt) return '';
  const milliseconds = Date.now() - new Date(startedAt).getTime();
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '';
  return formatSpan(milliseconds);
}

function renderStats(records) {
  const completed = records.filter((record) => record.status !== 'running');
  const succeeded = records.filter((record) => record.status === 'succeeded').length;
  const incomplete = records.filter((record) => record.status === 'incomplete').length;
  const running = records.filter((record) => record.status === 'running').length;
  const durations = completed
    .filter((record) => record.started_at && record.finished_at)
    .map((record) => new Date(record.finished_at).getTime() - new Date(record.started_at).getTime())
    .filter((value) => Number.isFinite(value) && value >= 0);
  const average = durations.length
    ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length / 1000)
    : undefined;

  const tiles = [
    { label: '执行次数', value: String(records.length), unit: '次' },
    {
      label: '成功率',
      value: completed.length ? ((succeeded / completed.length) * 100).toFixed(1) : '—',
      unit: completed.length ? '%' : '',
      note: completed.length ? succeeded + ' / ' + completed.length + ' 已结束' : '暂无已结束执行',
    },
    { label: '未完成', value: String(incomplete), unit: '次' },
    { label: '运行中', value: String(running), unit: '次' },
    {
      label: '平均耗时',
      value: average === undefined ? '—' : String(average),
      unit: average === undefined ? '' : '秒',
      note: average === undefined ? '暂无有效耗时' : durations.length + ' 条有效耗时',
    },
  ];
  element('run-stats').replaceChildren(
    ...tiles.map((tile) => {
      const card = document.createElement('div');
      card.className = 'stat';
      const label = document.createElement('span');
      label.className = 'stat-label';
      label.textContent = tile.label;
      const value = document.createElement('span');
      value.className = 'stat-value';
      value.textContent = tile.value;
      if (tile.unit) {
        const unit = document.createElement('span');
        unit.className = 'stat-unit';
        unit.textContent = tile.unit;
        value.append(unit);
      }
      card.append(label, value);
      if (tile.note) {
        const note = document.createElement('span');
        note.className = 'stat-note muted';
        note.textContent = tile.note;
        card.append(note);
      }
      return card;
    }),
  );

  const active = records.filter((record) => record.status === 'running');
  element('active-runs').hidden = !active.length;
  if (active.length) {
    const names = active.map((record) => record.task_id).join('、');
    const elapsed = formatElapsed(active[0].started_at);
    element('active-runs-detail').textContent = names + (elapsed ? ' · 已运行 ' + elapsed : '');
  }
}

function renderRun(record, withTask = true) {
  const row = document.createElement('tr');
  row.title = record.id;
  if (withTask) {
    const task = document.createElement('td');
    task.className = 'cell-task';
    task.textContent = record.task_id;
    row.append(task);
  }
  const mode = document.createElement('td');
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.dataset.mode = record.mode;
  badge.textContent = record.mode === 'preview' ? '只读预览' : '正式执行';
  mode.append(badge);
  const state = document.createElement('td');
  state.className = 'run-state';
  state.dataset.state = record.status;
  state.textContent = labels[record.status] ?? record.status;
  const started = document.createElement('td');
  started.className = 'cell-time';
  started.textContent = record.started_at ? dateFormat.format(new Date(record.started_at)) : '—';
  if (record.started_at) started.title = new Date(record.started_at).toISOString();
  const took = document.createElement('td');
  took.className = 'cell-time';
  took.textContent = formatDuration(record.started_at, record.finished_at);
  const actions = document.createElement('td');
  actions.className = 'cell-action';
  const detail = document.createElement('button');
  detail.className = 'icon-button small';
  detail.setAttribute('aria-label', '查看执行详情');
  detail.title = '查看执行详情';
  detail.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M2.7 12S6.3 5.8 12 5.8 21.3 12 21.3 12 17.7 18.2 12 18.2 2.7 12 2.7 12Z"/><circle cx="12" cy="12" r="2.7"/></svg>';
  detail.addEventListener('click', () => openRunDetail(record));
  actions.append(detail);
  row.append(mode, state, started, took, actions);
  return row;
}

function visibleRuns() {
  const term = searchTerm.trim().toLowerCase();
  return runs.filter((record) => {
    if (statusFilter !== 'all' && record.status !== statusFilter) return false;
    if (term && !record.task_id.toLowerCase().includes(term)) return false;
    return true;
  });
}

function showEmptyHistory(title, hint) {
  element('history-table').hidden = true;
  element('history-summary').hidden = true;
  element('history-empty').hidden = false;
  element('history-empty-title').textContent = title;
  const hintNode = element('history-empty-hint');
  hintNode.textContent = hint;
  hintNode.hidden = !hint;
}

async function refreshRuns() {
  try {
    runs = await api.recentRuns();
    renderStats(runs);
    const visible = visibleRuns();
    element('runs').replaceChildren(...visible.map((record) => renderRun(record)));
    element('history-table').hidden = !visible.length;
    element('history-summary').hidden = !visible.length;
    element('history-empty').hidden = Boolean(visible.length);
    if (visible.length) {
      element('history-summary').textContent =
        '显示 ' + visible.length + ' / ' + runs.length + ' 条记录，共记录 ' + runs.length + ' 条';
    } else if (runs.length) {
      showEmptyHistory('没有匹配的记录', '调整状态筛选或搜索关键词后重试。');
    } else if (flow.id) {
      showEmptyHistory('暂无运行记录', '运行一次流程后，记录会按时间倒序显示在这里。');
    } else {
      showEmptyHistory('尚未安装流程', '在「工作流管理」中导入流程包并运行后，记录会显示在这里。');
    }
    element('history-updated').textContent = '更新于 ' + timeFormat.format(new Date());
  } catch (error) {
    showEmptyHistory(
      '暂时无法读取运行记录',
      /No handler registered/.test(error.message)
        ? '工作台主进程仍是旧版本，重启后可查看历史。'
        : error.message,
    );
    element('history-updated').textContent = '';
  }
}

async function refreshFlowHistory() {
  if (!flow.id) return;
  try {
    const records = await api.taskRuns(flow.id);
    element('flow-runs').replaceChildren(...records.map((record) => renderRun(record, false)));
    element('flow-history-table').hidden = !records.length;
    element('flow-history-empty').hidden = Boolean(records.length);
    const count = element('flow-history-count');
    count.hidden = !records.length;
    count.textContent = String(records.length);
  } catch {
    element('flow-history-table').hidden = true;
    element('flow-history-empty').hidden = false;
  }
}

const failureAdvice = {
  TIMEOUT: '请求超过了 30 秒的单次超时限制。可稍后重试，或检查目标服务是否响应过慢。',
  CREDENTIAL_MISSING: '缺少该流程所需的凭证。请到「工作流管理 → 凭证」补全并保存后重试。',
  CREDENTIAL_INVALID: '凭证被目标服务拒绝。请到「工作流管理 → 凭证」更新对应的密钥后重试。',
  FORBIDDEN: '凭证对应的账号没有执行该操作的权限。',
  NOT_FOUND: '流程中声明的接口地址或目标表不存在。请检查流程定义。',
  RATE_LIMITED: '目标服务触发了频率限制。请降低执行频率或稍后重试。',
  NETWORK_ERROR: '无法连接到目标服务。请检查本机网络、代理与域名解析。',
  UPSTREAM_ERROR: '目标服务返回了错误状态码。可在系统设置中确认模型与接口配置后重试。',
  VALIDATION_ERROR: '流程数据不符合预期。请检查流程定义中的字段映射与去重键。',
  PROCESS_FAILED: '执行进程异常退出，未返回结构化结果。请重启客户端后重试。',
  PROCESS_TERMINATED: '执行被终止，可能超出了 300 秒的总时长限制。',
  INVALID_RESPONSE: '执行进程返回了无法解析的结果。请重启客户端后重试。',
  WORKFLOW_FAILED: '执行在返回具体原因前中断。',
};

const failureSummary = {
  TIMEOUT: '请求超时',
  CREDENTIAL_MISSING: '凭证缺失',
  CREDENTIAL_INVALID: '凭证无效',
  FORBIDDEN: '权限不足',
  NOT_FOUND: '目标不存在',
  RATE_LIMITED: '触发限流',
  NETWORK_ERROR: '网络连接失败',
  UPSTREAM_ERROR: '上游服务报错',
  VALIDATION_ERROR: '流程数据校验失败',
  PROCESS_FAILED: '执行进程异常',
  PROCESS_TERMINATED: '执行被终止',
  INVALID_RESPONSE: '结果无法解析',
  WORKFLOW_FAILED: '执行未完成',
};

function renderDiagnosis(record) {
  const panel = element('run-detail-diagnosis');
  const failed = record.status === 'incomplete' && record.failure_message;
  panel.hidden = !failed;
  if (!failed) return;

  const code = record.failure_code || 'WORKFLOW_FAILED';
  element('run-detail-code').textContent = code;
  element('run-detail-summary').textContent = failureSummary[code]
    ? failureSummary[code] + '：' + '执行中断'
    : '执行中断';
  element('run-detail-reason').textContent = record.failure_message;

  renderFailedSteps(record);
  element('run-detail-advice').textContent = failureAdvice[code] ?? '';
}

/**
 * Shows the flow steps and where the run stopped. The step list comes from the
 * installed workflow, so the failing step lines up with what the user sees in
 * the workflow overview.
 */
function renderFailedSteps(record) {
  const list = element('run-detail-steps');
  const steps = flow.steps ?? [];
  if (!steps.length) {
    list.replaceChildren();
    return;
  }
  const failedIndex = record.failed_step
    ? steps.findIndex((step) => step.id === record.failed_step)
    : -1;
  list.replaceChildren(
    ...steps.map((step, index) => {
      const node = document.createElement('div');
      node.className = 'step-node';
      const state =
        failedIndex === -1
          ? 'pending'
          : index < failedIndex
            ? 'done'
            : index === failedIndex
              ? 'failed'
              : 'pending';
      node.dataset.state = state;
      const order = document.createElement('span');
      order.className = 'step-index';
      order.textContent = String(index + 1);
      const label = document.createElement('span');
      label.className = 'step-label';
      label.textContent = opLabels[step.op] ?? step.op;
      const status = document.createElement('span');
      status.className = 'step-state';
      status.textContent = state === 'done' ? '已完成' : state === 'failed' ? '在此中断' : '未执行';
      node.append(order, label, status);
      return node;
    }),
  );
}

function openRunDetail(record) {
  const data = element('run-detail-data');
  const rows = [
    ['工作流', record.task_id],
    ['执行 ID', record.id],
    ['执行模式', record.mode === 'preview' ? '只读预览' : '正式执行'],
    ['状态', labels[record.status] ?? record.status],
    ['开始时间', record.started_at ? dateFormat.format(new Date(record.started_at)) : '—'],
    ['结束时间', record.finished_at ? dateFormat.format(new Date(record.finished_at)) : '—'],
    ['耗时', formatDuration(record.started_at, record.finished_at)],
  ];
  data.replaceChildren(
    ...rows
      .map(([label, value]) => {
        const term = document.createElement('dt');
        term.textContent = label;
        const description = document.createElement('dd');
        description.textContent = value;
        return [term, description];
      })
      .flat(),
  );
  renderDiagnosis(record);
  element('run-detail-note').textContent =
    record.status === 'running'
      ? '该执行仍在进行中，结束后才会写入最终状态。'
      : '此处仅展示执行元数据。历史执行结果与日志未通过桌面接口提供。';
  element('run-detail').showModal();
}

element('close-run-detail').addEventListener('click', () => element('run-detail').close());
element('refresh-runs').addEventListener('click', () => void refreshRuns());
element('run-filter').addEventListener('change', (event) => {
  statusFilter = event.target.value;
  void refreshRuns();
});
element('run-search').addEventListener('input', (event) => {
  searchTerm = event.target.value;
  void refreshRuns();
});

function importFlow() {
  return perform(
    async () => {
      const result = await api.importFlow();
      flow = result;
      element('result').hidden = true;
      element('status').textContent = result.imported ? '流程包已导入。' : defaultStatus();
      await refreshRuns();
      if (flow.id) await refreshFlowHistory();
    },
    element('status'),
    '正在选择流程包…',
  );
}

function switchFlow(id) {
  if (id === flow.id) return Promise.resolve();
  return perform(
    async () => {
      flow = await api.selectFlow(id);
      element('result').hidden = true;
      element('status').textContent = defaultStatus();
      await refreshFlowHistory();
    },
    element('status'),
    '正在切换流程…',
  );
}

element('flow-import-again').addEventListener('click', () => void importFlow());

function exportFlow(action) {
  return perform(
    async () => {
      element('status').textContent = (await action()) ? '流程包已导出。' : '已取消导出。';
    },
    element('status'),
    '请选择导出位置…',
  );
}
element('design-export').addEventListener('click', () => void exportFlow(api.exportDesign));
element('flow-export').addEventListener('click', () => void exportFlow(api.exportFlow));

function showResult(response, runMode) {
  const groups = response.result?.writes ?? [];
  element('result-title').textContent = runMode === 'preview' ? '预览结果（未写入）' : '执行结果';
  element('result-groups').replaceChildren(
    ...groups.map((group) => {
      const row = document.createElement('div');
      row.className = 'result-group';
      const label = document.createElement('span');
      label.textContent = { detail: '销售明细', summary: '销售汇总' }[group.stepId] ?? group.target;
      const count = document.createElement('strong');
      count.textContent = group.count + ' 条';
      row.append(label, count);
      return row;
    }),
  );
  element('result-json').textContent = JSON.stringify(response, null, 2);
  element('result').querySelector('details').open = false;
  element('result').hidden = false;
}

function run(runMode) {
  return perform(
    async () => {
      element('result').hidden = true;
      try {
        const response = await api.run({ mode: runMode });
        showResult(response, runMode);
        element('status').textContent = runMode === 'preview' ? '预览完成。' : '运行完成。';
      } finally {
        await refreshRuns();
        await refreshFlowHistory();
      }
    },
    element('status'),
    '正在运行流程…',
  );
}
element('preview').addEventListener('click', () => void run('preview'));
element('run').addEventListener('click', () => void run('replay'));

const flowTabs = ['overview', 'credentials', 'history'];
function selectFlowTab(name) {
  flowTab = name;
  for (const tab of flowTabs) {
    element('tab-flow-' + tab).setAttribute('aria-selected', String(tab === name));
    element('tab-flow-' + tab).tabIndex = tab === name ? 0 : -1;
    element('flow-' + tab).hidden = tab !== name;
  }
  if (name === 'history') void refreshFlowHistory();
}
for (const tab of flowTabs) {
  element('tab-flow-' + tab).addEventListener('click', () => selectFlowTab(tab));
  element('tab-flow-' + tab).addEventListener('keydown', (event) => {
    const index = flowTabs.indexOf(tab);
    const next = {
      ArrowLeft: flowTabs[(index + flowTabs.length - 1) % flowTabs.length],
      ArrowRight: flowTabs[(index + 1) % flowTabs.length],
    }[event.key];
    if (!next) return;
    event.preventDefault();
    selectFlowTab(next);
    element('tab-flow-' + next).focus();
  });
}

const credentialsForm = element('credentials');
credentialsForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void perform(
    async () => {
      const values = new FormData(credentialsForm);
      const targets = flow.fields?.targets ?? [];
      flow = await api.saveCredentials({
        values: values.getAll('credential'),
        bindings: targets.length
          ? {
              bitable: {
                baseToken: values.get('baseToken'),
                targets: Object.fromEntries(
                  targets.map((target) => [target, values.get('target-' + target)]),
                ),
              },
            }
          : {},
      });
      credentialsForm.reset();
      element('target-bindings').open = false;
      element('binding-status').textContent = '本机凭证已加密保存。';
      element('status').textContent = defaultStatus();
    },
    element('binding-status'),
    '正在保存本机配置…',
  );
});

const modelForm = element('model-settings');
function showModelConfig(config) {
  modelConfigured = config.hasAk;
  modelForm.elements.namedItem('base_url').value = config.base_url;
  modelForm.elements.namedItem('model').value = config.model;
  const ak = modelForm.elements.namedItem('ak');
  ak.value = '';
  ak.required = !config.hasAk;
  ak.placeholder = config.hasAk ? '已保存，留空保留当前 AK' : '';
  element('model-status').textContent = config.hasAk ? '模型配置已保存。' : '请保存模型配置。';
}
modelForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void perform(
    async () => {
      showModelConfig(await api.saveModelConfig(Object.fromEntries(new FormData(modelForm))));
    },
    element('model-status'),
    '正在保存模型配置…',
  );
});

function renderMessages() {
  const messages = threads[mode] ?? [];
  const log = element('messages');
  log.replaceChildren(
    ...messages.map(({ role, text }) => {
      const article = document.createElement('article');
      article.className = 'message';
      article.dataset.role = role;
      const label = document.createElement('span');
      label.textContent = role === 'agent' ? '设计 Agent' : '你';
      const body = document.createElement('p');
      body.textContent = text;
      article.append(label, body);
      return article;
    }),
  );
  log.scrollTop = log.scrollHeight;
}

function selectMode(next) {
  mode = next;
  element('chat-status').textContent = '';
  renderMessages();
  refresh();
  if (mode) element('chat-input').focus();
}

element('mode-api').addEventListener('click', () => selectMode('api'));
element('mode-rpa').addEventListener('click', () => selectMode('rpa'));
element('mode-back').addEventListener('click', () => selectMode(undefined));
element('chat-settings').addEventListener('click', () => selectTab('settings', true));
element('review-draft').addEventListener('click', () => {
  element('design-result').open = true;
  selectTab('workbench', true);
});

element('chat-reset').addEventListener(
  'click',
  () =>
    void perform(
      async () => {
        const currentMode = mode;
        await api.resetDesign(currentMode);
        if (currentMode === 'api') {
          threads.api = [{ role: 'agent', text: firstMessage }];
          awaitingPost = false;
          draft = undefined;
        } else {
          threads.rpa = [{ role: 'agent', text: rpaFirstMessage }];
          rpaSteps = [];
        }
        renderMessages();
        element('chat-status').textContent = '';
      },
      element('chat-status'),
      '正在新建会话…',
    ),
);

function send(message) {
  if (!mode || !message.trim() || busy) return;
  const currentMode = mode;
  const messages = threads[currentMode];
  const localAttachment = /\bcurl\s|^\s*[\[{]|```/i.test(message);
  messages.push({
    role: 'user',
    text: localAttachment ? '已提交接口资料（仅在本机解析）' : message,
  });
  renderMessages();
  element('chat-input').value = '';
  if (currentMode === 'api') {
    awaitingPost = false;
    draft = undefined;
  }
  void perform(
    async () => {
      try {
        if (currentMode === 'rpa') {
          const response = await api.sendRpaMessage(message);
          messages.push({ role: 'agent', text: response.reply });
          rpaSteps = response.steps;
          element('rpa-steps').replaceChildren(
            ...rpaSteps.map((step) => {
              const item = document.createElement('li');
              item.textContent = [step.action, step.target, step.expected].join(' · ');
              return item;
            }),
          );
          element('chat-status').textContent = '';
          return;
        }
        const response = await api.sendDesignMessage(message);
        messages.push({ role: 'agent', text: response.reply });
        awaitingPost = Boolean(response.confirmPost);
        draft = response.result;
        if (draft?.ready) {
          element('design-data').textContent = JSON.stringify(
            { flow: draft.flow, preview: draft.preview },
            null,
            2,
          );
        }
        element('chat-status').textContent = '';
      } finally {
        renderMessages();
      }
    },
    element('chat-status'),
    '设计 Agent 正在处理…',
  );
}

element('chat-form').addEventListener('submit', (event) => {
  event.preventDefault();
  send(element('chat-input').value);
});
element('confirm-post').addEventListener('click', () => send('确认只读 POST'));
element('chat-input').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    send(element('chat-input').value);
  }
});

void api
  .status()
  .then((value) => {
    flow = value;
    element('status').textContent = defaultStatus();
  })
  .catch((error) => {
    element('status').textContent = error.message;
  })
  .finally(() => {
    refresh();
    void refreshRuns();
  });
void api
  .getModelConfig()
  .then(showModelConfig)
  .catch((error) => {
    element('model-status').textContent = error.message;
  })
  .finally(refresh);
void api
  .runtimeStatus()
  .then((value) => {
    runtime = value;
  })
  .catch(() => {
    runtime = { ready: false };
  })
  .finally(refresh);
window.addEventListener('focus', () => {
  if (selectedTab === 'dashboard') void refreshRuns();
});
window.setInterval(() => {
  if (selectedTab === 'dashboard' && !document.hidden) void refreshRuns();
}, 15000);

selectTab(selectedTab);
selectFlowTab(flowTab);
refresh();
