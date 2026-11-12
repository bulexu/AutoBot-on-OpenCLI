<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Badge } from '@/components/ui/badge';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { api } from '@/ipc';
import type { FlowStatus, RunRecord, RunStep } from '@/ipc';
import {
  dateFormat,
  failureAdvice,
  failureSummary,
  formatDuration,
  modeLabels,
} from '@/lib/format';

const props = defineProps<{ record?: RunRecord; flow?: FlowStatus }>();
const emit = defineEmits<{ close: [] }>();

const open = computed(() => Boolean(props.record));
const detail = ref<RunRecord | undefined>(undefined);

watch(
  () => props.record,
  async (record) => {
    detail.value = record;
    if (!record) return;
    // The step trace is written while the run proceeds, so it is fetched after
    // the dialog opens and the pipeline map is refreshed in place.
    try {
      detail.value = await api.runDetail(record.id);
    } catch {
      // The trace is already on the record for recent runs; a failure here only
      // means the run predates step recording.
    }
  },
  { immediate: true },
);

const shown = computed(() => detail.value ?? props.record);

const diagnosis = computed(() => {
  const record = shown.value;
  if (!record || record.status !== 'incomplete' || !record.failure_message) return undefined;
  const code = record.failure_code || 'WORKFLOW_FAILED';
  return {
    code,
    summary: failureSummary[code] ? failureSummary[code] + '：执行中断' : '执行中断',
    reason: record.failure_message,
    advice: failureAdvice[code] ?? '',
  };
});

const opLabels: Record<string, string> = {
  'competitor.monthly': '竞品月销量抓取',
  'http.read': 'HTTP 读取',
  'records.map': '字段映射',
  'bitable.upsert': '写入目标表',
};

interface StepEntry {
  id: string;
  op: string;
  status?: string;
  rows?: number;
  target?: string | null;
  duration_ms?: number | null;
  state?: string;
}

/**
 * Draws the execution path. The recorded steps are the source of truth; the
 * workflow definition fills in the steps that never ran, so the user can see
 * exactly where the pipeline stopped.
 */
const steps = computed<StepEntry[]>(() => {
  const record = shown.value;
  if (!record) return [];
  const recorded = new Map((record.steps ?? []).map((step: RunStep) => [step.step_id, step]));
  const defined = props.flow?.steps ?? [];
  const entries = defined.length
    ? defined.map((step) => ({ ...recorded.get(step.id), id: step.id, op: step.op }))
    : [...recorded.values()].map((step) => ({
        ...step,
        id: step.step_id,
        op: step.op,
      }));
  // A run recorded before the step trace existed has no evidence either way,
  // so its steps are marked as unrecorded rather than as never executed.
  const traced = recorded.size > 0;
  return entries.map((entry) => ({
    ...entry,
    state: stepState(entry, traced, record),
  }));
});

function stepState(entry: StepEntry, traced: boolean, record: RunRecord) {
  if (entry.status === 'failed') return 'failed';
  if (entry.status) return 'done';
  if (!traced) return 'unknown';
  return entry.id === record.failed_step ? 'failed' : 'pending';
}

function stepDetail(entry: StepEntry) {
  if (entry.state === 'failed')
    return entry.target ? '在此中断 · 目标表 · ' + entry.target : '在此中断';
  if (entry.state === 'pending') return '未执行';
  if (entry.state === 'unknown') return '无步骤记录';
  const parts: string[] = [];
  if (entry.rows) parts.push(entry.rows + ' 条记录');
  if (entry.target) parts.push('目标表 · ' + entry.target);
  return parts.join(' · ') || '已完成';
}

const facts = computed(() => {
  const record = shown.value;
  if (!record) return [];
  return [
    {
      label: '开始时间',
      value: record.started_at ? dateFormat.format(new Date(record.started_at)) : '—',
    },
    {
      label: '结束时间',
      value: record.finished_at ? dateFormat.format(new Date(record.finished_at)) : '—',
    },
    { label: '耗时', value: formatDuration(record.started_at, record.finished_at) },
  ];
});

const technical = computed(() => {
  const record = shown.value;
  if (!record) return [];
  return [
    { label: '工作流', value: record.task_id },
    { label: '执行 ID', value: record.id },
    { label: '执行模式', value: modeLabels[record.mode] },
    { label: '状态', value: record.status },
    {
      label: '开始时间',
      value: record.started_at ? dateFormat.format(new Date(record.started_at)) : '—',
    },
    {
      label: '结束时间',
      value: record.finished_at ? dateFormat.format(new Date(record.finished_at)) : '—',
    },
    { label: '耗时', value: formatDuration(record.started_at, record.finished_at) },
  ];
});

const note = computed(() => {
  const record = shown.value;
  if (!record) return '';
  if (record.status === 'running') return '该执行仍在进行中，结束后才会写入最终状态。';
  if (record.status === 'incomplete' && !record.failure_message)
    return '该执行在本次升级之前完成，没有记录失败原因。';
  return '步骤与耗时来自本次执行的真实记录。';
});
</script>

<template>
  <Sheet :open="open" @update:open="(value) => !value && emit('close')">
    <SheetContent side="right" class="run-detail">
      <SheetHeader>
        <SheetTitle>{{ shown?.task_id || '执行记录详情' }}</SheetTitle>
        <SheetDescription>
          {{ shown ? shown.id + ' · ' + modeLabels[shown.mode] : '' }}
        </SheetDescription>
      </SheetHeader>

      <div class="run-detail-facts">
        <div v-for="fact in facts" :key="fact.label" class="fact">
          <span class="fact-label">{{ fact.label }}</span>
          <span class="fact-value">{{ fact.value }}</span>
        </div>
      </div>

      <section v-if="diagnosis" class="diagnosis">
        <div class="diagnosis-head">
          <Badge class="diagnosis-badge">{{ diagnosis.code }}</Badge>
          <strong>{{ diagnosis.summary }}</strong>
        </div>
        <p class="diagnosis-reason">{{ diagnosis.reason }}</p>
        <p v-if="diagnosis.advice" class="diagnosis-advice">{{ diagnosis.advice }}</p>
      </section>

      <section class="run-detail-section" aria-labelledby="run-detail-pipeline-title">
        <h3 id="run-detail-pipeline-title" class="detail-section-title">执行步骤</h3>
        <ol class="step-timeline">
          <li
            v-for="(step, index) in steps"
            :key="step.id"
            class="step-node"
            :data-state="step.state"
          >
            <span class="step-index">{{ index + 1 }}</span>
            <span class="step-body">
              <span class="step-label">{{ opLabels[step.op] ?? step.op }}</span>
              <span class="step-detail">{{ stepDetail(step) }}</span>
            </span>
            <span v-if="step.duration_ms != null" class="step-meta">{{ step.duration_ms }} ms</span>
          </li>
        </ol>
      </section>

      <details class="technical">
        <summary>技术信息</summary>
        <dl class="detail-list">
          <template v-for="row in technical" :key="row.label">
            <dt>{{ row.label }}</dt>
            <dd>{{ row.value }}</dd>
          </template>
        </dl>
      </details>

      <div class="dialog-foot">
        <p class="muted">{{ note }}</p>
      </div>
    </SheetContent>
  </Sheet>
</template>
