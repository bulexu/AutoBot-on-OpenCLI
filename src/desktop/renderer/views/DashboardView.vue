<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { Eye, RefreshCw } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import RunDetailDialog from '@/components/app/RunDetailDialog.vue';
import { api } from '@/ipc';
import type { RunRecord } from '@/ipc';
import { dateFormat, formatDuration, modeLabels, statusLabels, timeFormat } from '@/lib/format';

const runs = ref<RunRecord[]>([]);
const statusFilter = ref('all');
const searchTerm = ref('');
const updatedAt = ref('');
const loadError = ref('');
const selected = ref<RunRecord | undefined>(undefined);

const active = computed(() => runs.value.filter((record) => record.status === 'running'));

const visible = computed(() => {
  const term = searchTerm.value.trim().toLowerCase();
  return runs.value.filter((record) => {
    if (statusFilter.value !== 'all' && record.status !== statusFilter.value) return false;
    if (term && !record.task_id.toLowerCase().includes(term)) return false;
    return true;
  });
});

/**
 * Statistics come from the records the runtime actually returned. The scope is
 * the most recent 30 runs, which is what `recentRuns()` returns, and the rate
 * counts only the runs that already finished.
 */
const tiles = computed(() => {
  const records = runs.value;
  const completed = records.filter((record) => record.status !== 'running');
  const succeeded = records.filter((record) => record.status === 'succeeded').length;
  const incomplete = records.filter((record) => record.status === 'incomplete').length;
  const running = records.filter((record) => record.status === 'running').length;
  const durations = completed
    .filter((record) => record.started_at && record.finished_at)
    .map(
      (record) => new Date(record.finished_at!).getTime() - new Date(record.started_at!).getTime(),
    )
    .filter((value) => Number.isFinite(value) && value >= 0);
  const average = durations.length
    ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length / 1000)
    : undefined;

  return [
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
});

const emptyState = computed(() => {
  if (loadError.value) return { title: '暂时无法读取运行记录', hint: loadError.value };
  if (runs.value.length && !visible.value.length)
    return { title: '没有匹配的记录', hint: '调整状态筛选或搜索关键词后重试。' };
  if (runs.value.length) return { title: '', hint: '' };
  return {
    title: '尚未安装流程',
    hint: '在「工作流管理」中导入流程包并运行后，记录会显示在这里。',
  };
});

async function refresh() {
  try {
    runs.value = await api.recentRuns();
    loadError.value = '';
    updatedAt.value = timeFormat.format(new Date());
  } catch (error) {
    loadError.value = /No handler registered/.test(String(error))
      ? '工作台主进程仍是旧版本，重启后可查看历史。'
      : error instanceof Error
        ? error.message
        : String(error);
  }
}

let timer: number | undefined;
onMounted(() => {
  void refresh();
  timer = window.setInterval(() => {
    if (!document.hidden) void refresh();
  }, 15000);
});
onUnmounted(() => {
  if (timer) window.clearInterval(timer);
});
</script>

<template>
  <section class="view" aria-labelledby="dashboard-title">
    <div class="content-head">
      <div>
        <h1 id="dashboard-title">执行看板</h1>
        <p class="muted">最近 30 条执行记录</p>
      </div>
      <div class="head-actions">
        <span class="muted">{{ updatedAt ? '更新于 ' + updatedAt : '' }}</span>
        <Button
          variant="outline"
          size="icon"
          aria-label="刷新运行记录"
          title="刷新运行记录"
          @click="refresh"
        >
          <RefreshCw />
        </Button>
      </div>
    </div>

    <section class="stats-section" aria-labelledby="stats-title">
      <h2 id="stats-title" class="section-title">执行统计</h2>
      <p class="muted stats-note">
        统计范围为最近 30 条执行记录，成功率以已结束的执行为分母，不受下方列表筛选影响。
      </p>
      <div class="stats">
        <Card v-for="tile in tiles" :key="tile.label" class="stat-tile">
          <CardContent class="stat-body">
            <span class="stat-label">{{ tile.label }}</span>
            <span class="stat-value">
              {{ tile.value }}<span v-if="tile.unit" class="stat-unit">{{ tile.unit }}</span>
            </span>
            <span v-if="tile.note" class="stat-note muted">{{ tile.note }}</span>
          </CardContent>
        </Card>
      </div>
    </section>

    <section v-if="active.length" class="active-strip" aria-label="正在运行的任务">
      <span class="pulse" aria-hidden="true"></span>
      <span class="muted">运行中</span>
      <span class="muted">{{ active.map((record) => record.task_id).join('、') }}</span>
    </section>

    <section class="panel history" aria-labelledby="history-title">
      <div class="panel-heading">
        <h2 id="history-title">执行记录</h2>
        <div class="history-tools">
          <Select v-model="statusFilter">
            <SelectTrigger class="filter-trigger" aria-label="按状态筛选">
              <SelectValue placeholder="全部状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="succeeded">成功</SelectItem>
              <SelectItem value="incomplete">未完成</SelectItem>
              <SelectItem value="running">运行中</SelectItem>
            </SelectContent>
          </Select>
          <Input
            v-model="searchTerm"
            class="filter-input"
            type="search"
            placeholder="搜索工作流名称"
            aria-label="按工作流搜索"
          />
        </div>
      </div>

      <p v-if="visible.length" class="muted history-summary">
        显示 {{ visible.length }} / {{ runs.length }} 条记录，共记录 {{ runs.length }} 条
      </p>

      <Table v-if="visible.length" class="run-table">
        <TableHeader>
          <TableRow>
            <TableHead>工作流</TableHead>
            <TableHead>模式</TableHead>
            <TableHead>状态</TableHead>
            <TableHead>开始时间</TableHead>
            <TableHead>耗时</TableHead>
            <TableHead><span class="sr-only">操作</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="record in visible" :key="record.id">
            <TableCell class="cell-task">{{ record.task_id }}</TableCell>
            <TableCell>
              <Badge variant="outline" :data-mode="record.mode">{{
                modeLabels[record.mode]
              }}</Badge>
            </TableCell>
            <TableCell>
              <span class="run-state" :data-state="record.status">
                {{ statusLabels[record.status] ?? record.status }}
              </span>
            </TableCell>
            <TableCell class="cell-time">
              {{ record.started_at ? dateFormat.format(new Date(record.started_at)) : '—' }}
            </TableCell>
            <TableCell class="cell-time">
              {{ formatDuration(record.started_at, record.finished_at) }}
            </TableCell>
            <TableCell class="cell-action">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="查看执行详情"
                title="查看执行详情"
                @click="selected = record"
              >
                <Eye />
              </Button>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>

      <Empty v-else class="history-empty">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Eye />
          </EmptyMedia>
          <EmptyTitle>{{ emptyState.title }}</EmptyTitle>
          <EmptyDescription v-if="emptyState.hint">{{ emptyState.hint }}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </section>

    <RunDetailDialog :record="selected" @close="selected = undefined" />
  </section>
</template>
