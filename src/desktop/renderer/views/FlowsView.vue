<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { Download, Eye, Pencil, Play, Upload, Workflow } from '@lucide/vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/ipc';
import type { FlowStatus, RunRecord } from '@/ipc';
import { dateFormat, formatDuration, modeLabels, runStatus, statusLabels } from '@/lib/format';

const flow = ref<FlowStatus>({});
const runs = ref<RunRecord[]>([]);
const busy = ref(false);
const feedback = ref('');
const bindingFeedback = ref('');
const inputsFeedback = ref('');
const scheduleFeedback = ref('');
const aliasEditing = ref(false);
const aliasDraft = ref('');
const cron = ref('');
const inputs = ref<Record<string, string | number>>({});
const credentialValues = ref<string[]>([]);
const targetValues = ref<Record<string, string>>({});
const baseToken = ref('');
const result = ref<{
  writes: { stepId: string; target: string; count: number }[];
  browserResults?: { stepId: string; title: string; url: string }[];
}>();

const opLabels: Record<string, string> = {
  'competitor.monthly': '竞品月销量抓取',
  'browser.open': '打开网页',
  'browser.title': '读取页面标题',
  'http.read': 'HTTP 读取',
  'records.map': '字段映射',
  'bitable.upsert': '写入目标表',
};

const tableLabels: Record<string, string> = {
  rates: '站点汇率',
  competitors: '竞品监控',
  detail: '销售明细',
  summary: '销售汇总',
};

const hasFlow = computed(() => Boolean(flow.value.id));
const credentials = computed(() => flow.value.fields?.credentials ?? []);
const targets = computed(() => flow.value.fields?.targets ?? []);

async function load() {
  try {
    flow.value = await api.status();
    syncInputs();
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : String(error);
  }
}

function syncInputs() {
  cron.value = flow.value.cron ?? '';
  inputsFeedback.value = '';
  scheduleFeedback.value = '';
  const next: Record<string, string> = {};
  for (const field of flow.value.inputs ?? []) {
    const value = flow.value.inputValues?.[field.key];
    next[field.key] = value === undefined ? String(field.default ?? '') : String(value);
  }
  inputs.value = next;
}

watch(() => flow.value.id, syncInputs);

async function guard(action: () => Promise<void>, pending: string, message = feedback) {
  if (busy.value) return;
  busy.value = true;
  message.value = pending;
  try {
    await action();
  } catch (error) {
    message.value = error instanceof Error ? error.message : String(error);
  } finally {
    busy.value = false;
  }
}

function importFlow() {
  return guard(async () => {
    const result = await api.importFlow();
    flow.value = result;
    feedback.value = result.imported ? '流程包已导入。' : '';
    await refreshHistory();
  }, '正在选择流程包…');
}

async function switchFlow(id: string) {
  if (id === flow.value.id) return;
  return guard(async () => {
    flow.value = await api.selectFlow(id);
    feedback.value = '';
    await refreshHistory();
  }, '正在切换流程…');
}

function exportFlow() {
  return guard(async () => {
    feedback.value = (await api.exportFlow()) ? '流程包已导出。' : '已取消导出。';
  }, '请选择导出位置…');
}

function readInputs() {
  const values: Record<string, string | number | boolean> = {};
  for (const field of flow.value.inputs ?? []) {
    const raw = String(inputs.value[field.key] ?? '').trim();
    if (!raw) continue;
    values[field.key] =
      field.type === 'number' ? Number(raw) : field.type === 'boolean' ? raw === 'true' : raw;
  }
  return values;
}

function saveInputs() {
  return guard(
    async () => {
      flow.value = await api.saveFlowPreferences({
        alias: flow.value.alias ?? '',
        inputs: readInputs(),
        cron: flow.value.cron ?? '',
      });
      inputsFeedback.value = '动态参数已保存。';
    },
    '正在保存动态参数…',
    inputsFeedback,
  );
}

function saveSchedule() {
  return guard(
    async () => {
      flow.value = await api.saveFlowPreferences({
        alias: flow.value.alias ?? '',
        inputs: { ...flow.value.inputValues },
        cron: cron.value,
      });
      cron.value = flow.value.cron ?? '';
      scheduleFeedback.value = cron.value ? '定时任务已保存。' : '定时任务已关闭。';
    },
    '正在保存定时任务…',
    scheduleFeedback,
  );
}

function saveAlias() {
  aliasEditing.value = false;
  const next = aliasDraft.value.trim();
  if (!next || next === (flow.value.alias ?? flow.value.id)) return;
  return guard(async () => {
    flow.value = await api.saveFlowPreferences({
      alias: next,
      inputs: { ...flow.value.inputValues },
      cron: flow.value.cron ?? '',
    });
    feedback.value = '别名已更新。';
  }, '正在保存别名…');
}

function saveCredentials() {
  return guard(
    async () => {
      flow.value = await api.saveCredentials({
        values: credentials.value.map((_, index) => credentialValues.value[index] ?? ''),
        bindings: targets.value.length
          ? {
              bitable: {
                baseToken: baseToken.value,
                targets: Object.fromEntries(
                  targets.value.map((target) => [target, targetValues.value[target] ?? '']),
                ),
              },
            }
          : {},
      });
      credentialValues.value = [];
      targetValues.value = {};
      baseToken.value = '';
      bindingFeedback.value = '本机凭证已加密保存。';
    },
    '正在保存本机配置…',
    bindingFeedback,
  );
}

function run(mode: 'preview' | 'replay') {
  return guard(async () => {
    result.value = undefined;
    try {
      const response = await api.run({ mode, inputs: readInputs() });
      result.value = response.result as typeof result.value;
      feedback.value = response.result?.warnings?.length
        ? '部分完成。查看调试详情了解跳过的记录。'
        : mode === 'preview'
          ? '预览完成。'
          : '运行完成。';
    } finally {
      await refreshHistory();
    }
  }, '正在运行流程…');
}

async function refreshHistory() {
  if (!flow.value.id) return;
  try {
    runs.value = await api.taskRuns(flow.value.id);
  } catch {
    runs.value = [];
  }
}

onMounted(async () => {
  await load();
  await refreshHistory();
});
</script>

<template>
  <section class="view" aria-labelledby="flows-title">
    <div class="content-head">
      <div>
        <h1 id="flows-title">工作流管理</h1>
        <p class="muted">已安装 {{ flow.flows?.length ?? 0 }} 个流程</p>
      </div>
      <div class="head-actions">
        <Button variant="outline" :disabled="busy || !hasFlow" @click="exportFlow">
          <Download />导出
        </Button>
        <Button :disabled="busy" @click="importFlow"> <Upload />导入流程包 </Button>
      </div>
    </div>

    <div class="flow-layout">
      <aside class="panel flow-library" aria-labelledby="library-title">
        <div class="panel-heading">
          <h2 id="library-title">已安装流程</h2>
        </div>
        <div class="flow-list">
          <button
            v-for="item in flow.flows ?? []"
            :key="item.id"
            type="button"
            class="flow-option"
            :data-active="item.id === flow.id"
            @click="switchFlow(item.id)"
          >
            <span class="flow-option-text">
              <span class="flow-option-name">{{ item.alias ?? item.id }}</span>
              <span class="muted">
                {{
                  [
                    item.version ? 'v' + item.version : '',
                    item.credentialCount ? item.credentialCount + ' 项凭证' : '无需凭证',
                  ]
                    .filter(Boolean)
                    .join(' · ')
                }}
              </span>
            </span>
            <Badge variant="outline" :data-state="item.credentialsSaved ? 'ready' : 'pending'">
              {{ item.credentialsSaved ? '已配置' : '待配置' }}
            </Badge>
          </button>
        </div>
        <p v-if="!(flow.flows ?? []).length" class="muted flow-list-empty">
          暂无流程，导入 .flow 文件开始使用。
        </p>
      </aside>

      <section class="panel task" aria-labelledby="flow">
        <div class="task-head">
          <div class="flow-identity">
            <span class="flow-icon" aria-hidden="true"><Workflow :size="18" /></span>
            <div class="flow-text">
              <h2
                v-if="!aliasEditing"
                id="flow"
                title="双击编辑别名"
                @dblclick="aliasEditing = true"
              >
                {{ flow.alias ?? flow.id ?? '尚未安装流程' }}
              </h2>
              <Input
                v-else
                v-model="aliasDraft"
                aria-label="工作流别名"
                maxlength="80"
                @blur="saveAlias"
                @keydown.enter.prevent="saveAlias"
                @keydown.esc.prevent="aliasEditing = false"
              />
              <p class="muted">
                {{ flow.version ? 'v' + flow.version : '导入流程包后可在此配置并运行。' }}
              </p>
            </div>
          </div>
          <div class="task-actions">
            <Button
              v-if="hasFlow"
              variant="outline"
              size="icon"
              :disabled="busy"
              aria-label="只读预览：不写入目标表"
              title="只读预览：不写入目标表"
              @click="run('preview')"
            >
              <Eye />
            </Button>
            <Button
              v-if="hasFlow"
              :disabled="busy"
              aria-label="正式执行并写入"
              title="正式执行并写入"
              @click="run('replay')"
            >
              <Play />正式执行
            </Button>
          </div>
        </div>

        <Tabs default-value="overview" class="flow-tabs">
          <TabsList>
            <TabsTrigger value="overview">概览</TabsTrigger>
            <TabsTrigger value="credentials">
              凭证
              <Badge
                v-if="credentials.length || targets.length"
                class="tab-badge"
                variant="secondary"
              >
                {{ credentials.length + targets.length }}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="history">
              执行历史
              <Badge v-if="runs.length" class="tab-badge" variant="secondary">{{
                runs.length
              }}</Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <form
              v-if="flow.inputs?.length"
              class="flow-preferences"
              aria-labelledby="flow-inputs-title"
              @submit.prevent="saveInputs"
            >
              <h3 id="flow-inputs-title" class="metadata-title">动态参数</h3>
              <FieldGroup class="settings-grid">
                <Field v-for="field in flow.inputs ?? []" :key="field.key">
                  <FieldLabel :for="'input-' + field.key">{{ field.label }}</FieldLabel>
                  <Input
                    :id="'input-' + field.key"
                    v-model="inputs[field.key]"
                    :type="field.type === 'number' ? 'number' : 'text'"
                    :min="field.min"
                    :max="field.max"
                    :step="field.type === 'number' ? 'any' : undefined"
                    :required="field.required"
                    :placeholder="field.type === 'month' ? 'YYYY-MM' : undefined"
                  />
                </Field>
              </FieldGroup>
              <div class="actions">
                <Button type="submit" variant="outline" :disabled="busy">保存参数</Button>
                <span class="feedback" role="status">{{ inputsFeedback }}</span>
              </div>
            </form>

            <form
              class="flow-preferences"
              aria-labelledby="flow-schedule-title"
              @submit.prevent="saveSchedule"
            >
              <h3 id="flow-schedule-title" class="metadata-title">定时任务</h3>
              <FieldGroup class="settings-grid">
                <Field>
                  <FieldLabel for="run-cron">定时执行（Cron）</FieldLabel>
                  <Input id="run-cron" v-model="cron" placeholder="0 9 * * 1-5，留空关闭" />
                  <p v-if="flow.timeZone" class="muted field-hint">
                    本机时区 · {{ flow.timeZone }}
                  </p>
                </Field>
              </FieldGroup>
              <div class="actions">
                <Button type="submit" variant="outline" :disabled="busy">保存定时任务</Button>
                <span class="feedback" role="status">{{ scheduleFeedback }}</span>
              </div>
            </form>

            <section v-if="flow.steps?.length" class="flow-metadata">
              <h3 class="metadata-title">执行步骤</h3>
              <ol class="step-list">
                <li v-for="(step, index) in flow.steps" :key="step.id">
                  <span class="step-order">{{ index + 1 }}</span>
                  <span class="step-text">
                    <strong>{{ opLabels[step.op] ?? step.op }}</strong>
                    <span class="muted">
                      {{
                        [
                          step.url ? (step.method ?? 'GET') + ' ' + step.url : '',
                          step.target ? '目标表 · ' + step.target : '',
                        ]
                          .filter(Boolean)
                          .join(' · ') || step.id
                      }}
                    </span>
                  </span>
                </li>
              </ol>
            </section>

            <section v-if="flow.fixedTables" class="flow-metadata">
              <h3 class="metadata-title">流程包绑定的目标表</h3>
              <ul class="table-list">
                <li v-for="(id, role) in flow.fixedTables" :key="role">
                  <span class="muted">{{ tableLabels[role] ?? role }}</span>
                  <code>{{ id }}</code>
                </li>
              </ul>
            </section>

            <p class="feedback" role="status">{{ feedback }}</p>
          </TabsContent>

          <TabsContent value="credentials">
            <div class="flow-bindings">
              <div class="panel-heading">
                <h3>本机凭证</h3>
                <Badge variant="outline" :data-state="flow.credentialsSaved ? 'ready' : 'pending'">
                  {{ flow.credentialsSaved ? '已配置' : '待配置' }}
                </Badge>
              </div>
              <p class="muted credentials-note">
                凭证使用系统钥匙串加密保存在本机，仅在执行时解密，不随流程包导出。
              </p>
              <form
                class="credentials-form"
                autocomplete="off"
                novalidate
                @submit.prevent="saveCredentials"
              >
                <FieldGroup class="settings-grid">
                  <Field v-for="field in credentials" :key="field.name">
                    <FieldLabel :for="'cred-' + field.name">{{ field.label }}</FieldLabel>
                    <Input
                      :id="'cred-' + field.name"
                      v-model="credentialValues[credentials.indexOf(field)]"
                      type="password"
                      :required="!flow.credentialsSaved"
                      :placeholder="flow.credentialsSaved ? '已配置，留空保留当前值' : undefined"
                    />
                  </Field>
                  <template v-if="targets.length">
                    <Field>
                      <FieldLabel for="base-token">飞书多维表格 Token</FieldLabel>
                      <Input
                        id="base-token"
                        v-model="baseToken"
                        type="text"
                        :required="!flow.credentialsSaved"
                      />
                    </Field>
                    <Field v-for="target in targets" :key="target">
                      <FieldLabel :for="'target-' + target">目标表 · {{ target }}</FieldLabel>
                      <Input
                        :id="'target-' + target"
                        v-model="targetValues[target]"
                        type="text"
                        :required="!flow.credentialsSaved"
                      />
                    </Field>
                  </template>
                </FieldGroup>
                <div class="actions">
                  <Button type="submit" :disabled="busy">
                    {{ busy ? '保存中…' : '保存凭证' }}
                  </Button>
                  <span class="feedback" role="status">{{ bindingFeedback }}</span>
                </div>
              </form>
            </div>
          </TabsContent>

          <TabsContent value="history">
            <p v-if="!runs.length" class="muted">该流程尚无执行记录。</p>
            <Table v-else class="run-table">
              <TableHeader>
                <TableRow>
                  <TableHead>模式</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>开始时间</TableHead>
                  <TableHead>耗时</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="record in runs" :key="record.id">
                  <TableCell>
                    <Badge variant="outline" :data-mode="record.mode">
                      {{ modeLabels[record.mode] }}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span class="run-state" :data-state="runStatus(record)">
                      {{ statusLabels[runStatus(record)] ?? record.status }}
                    </span>
                  </TableCell>
                  <TableCell class="cell-time">
                    {{ record.started_at ? dateFormat.format(new Date(record.started_at)) : '—' }}
                  </TableCell>
                  <TableCell class="cell-time">
                    {{ formatDuration(record.started_at, record.finished_at) }}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TabsContent>
        </Tabs>

        <section v-if="result" class="result">
          <h3 class="metadata-title">执行结果</h3>
          <div v-for="page in result.browserResults" :key="page.stepId" class="result-group">
            <span class="break-all">{{ page.url }}</span>
            <strong>{{ page.title }}</strong>
          </div>
          <div class="result-groups">
            <div v-for="group in result.writes" :key="group.stepId" class="result-group">
              <span>{{ group.target }}</span>
              <strong>{{ group.count }} 条</strong>
            </div>
          </div>
        </section>
      </section>
    </div>
  </section>
</template>
