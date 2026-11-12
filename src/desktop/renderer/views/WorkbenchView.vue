<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { ArrowLeft, Download, MessageSquareCode, MousePointerClick } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import DesignConversation from '@/components/app/DesignConversation.vue';
import { api } from '@/ipc';
import type { DesignDraft, RpaResponse } from '@/ipc';

type Mode = 'api' | 'rpa';
interface ChatMessage {
  role: 'user' | 'agent';
  text: string;
}

const firstMessage = '你希望自动化什么任务？可以直接描述目标，或把 cURL 和脱敏响应样例发给我。';
const rpaFirstMessage =
  '请描述你希望在浏览器中完成的操作，以及怎样判断成功。请勿提供密码、Cookie 或验证码。草案的执行验证将在 P3 接入。';

const mode = ref<Mode | undefined>(undefined);
const threads = ref<Record<Mode, ChatMessage[]>>({
  api: [{ role: 'agent', text: firstMessage }],
  rpa: [{ role: 'agent', text: rpaFirstMessage }],
});
const busy = ref(false);
const awaitingPost = ref(false);
const draft = ref<DesignDraft | undefined>(undefined);
const rpaSteps = ref<RpaResponse['steps']>([]);
const feedback = ref('');
const draftOpen = ref(false);

const starters = computed(() =>
  mode.value === 'rpa'
    ? ['从后台页面导出订单列表', '在浏览器里批量填写表单']
    : ['把订单 API 的数据同步到飞书多维表格', '从分页 API 读取记录并映射字段'],
);

const messages = computed(() => (mode.value ? threads.value[mode.value] : []));
const isApi = computed(() => mode.value === 'api');

function selectMode(next: Mode) {
  mode.value = next;
  feedback.value = '';
}

function backToModes() {
  mode.value = undefined;
  feedback.value = '';
}

async function send(text: string) {
  const current = mode.value;
  if (!current || !text.trim() || busy.value) return;
  const trimmed = text.trim();

  // cURL and JSON payloads are parsed on the main process, so the transcript
  // only records that the material was handed over.
  const localAttachment = /\bcurl\s|^\s*[\[{]|```/i.test(trimmed);
  threads.value[current].push({
    role: 'user',
    text: localAttachment ? '已提交接口资料（仅在本机解析）' : trimmed,
  });
  if (current === 'api') {
    awaitingPost.value = false;
    draft.value = undefined;
  }

  busy.value = true;
  feedback.value = '设计 Agent 正在处理…';
  try {
    if (current === 'rpa') {
      const response = await api.sendRpaMessage(trimmed);
      threads.value.rpa.push({ role: 'agent', text: response.reply });
      rpaSteps.value = response.steps;
    } else {
      const response = await api.sendDesignMessage(trimmed);
      threads.value.api.push({ role: 'agent', text: response.reply });
      awaitingPost.value = Boolean(response.confirmPost);
      draft.value = response.result;
    }
    feedback.value = '';
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : String(error);
  } finally {
    busy.value = false;
  }
}

async function reset() {
  const current = mode.value;
  if (!current) return;
  busy.value = true;
  try {
    await api.resetDesign(current);
    threads.value[current] = [
      { role: 'agent', text: current === 'api' ? firstMessage : rpaFirstMessage },
    ];
    if (current === 'api') {
      awaitingPost.value = false;
      draft.value = undefined;
    } else {
      rpaSteps.value = [];
    }
    feedback.value = '';
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : String(error);
  } finally {
    busy.value = false;
  }
}

async function exportDraft() {
  busy.value = true;
  try {
    feedback.value = '请选择导出位置…';
    feedback.value = (await api.exportDesign()) ? '流程包已导出。' : '已取消导出。';
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : String(error);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="view" aria-labelledby="workbench-title">
    <div class="content-head">
      <div>
        <h1 id="workbench-title">工作台</h1>
        <p class="muted">通过对话设计流程草稿并试跑验证。</p>
      </div>
      <div class="head-actions">
        <Button v-if="mode" variant="outline" :disabled="busy" @click="reset">新会话</Button>
      </div>
    </div>

    <Card v-if="draft?.ready" class="notice">
      <CardContent class="notice-body">
        <div>
          <strong>设计草稿已通过试跑</strong>
          <p>确认后可导出流程包。</p>
        </div>
        <Button :disabled="busy" @click="exportDraft"> <Download />确认并导出 .flow </Button>
      </CardContent>
    </Card>

    <div v-if="!mode" class="modes">
      <button type="button" class="mode" @click="selectMode('api')">
        <span class="mode-mark" aria-hidden="true">{ }</span>
        <strong>API</strong>
        <span>连接 HTTP 接口，同步结构化数据。</span>
        <span class="mode-action">开始设计 →</span>
      </button>
      <button type="button" class="mode" @click="selectMode('rpa')">
        <span class="mode-mark" aria-hidden="true"><MousePointerClick :size="13" /></span>
        <strong>RPA</strong>
        <span>生成浏览器操作草案，尚不支持执行验证。</span>
        <span class="mode-action">开始设计 →</span>
      </button>
    </div>

    <Card v-else class="chat-card">
      <div class="chat-heading">
        <div class="chat-mode">
          <MessageSquareCode v-if="isApi" class="chat-mode-icon" aria-hidden="true" />
          <MousePointerClick v-else class="chat-mode-icon" aria-hidden="true" />
          <strong>{{ isApi ? 'API 设计' : 'RPA 设计' }}</strong>
          <Badge variant="outline">{{ isApi ? '只读试跑' : '待执行验证' }}</Badge>
        </div>
        <Button variant="ghost" size="sm" :disabled="busy" @click="backToModes">
          <ArrowLeft />切换模式
        </Button>
      </div>

      <DesignConversation
        :messages="messages"
        :busy="busy"
        :starters="starters"
        :placeholder="
          isApi ? '描述同步目标，或粘贴 cURL 和脱敏 JSON…' : '描述目标页面、操作和预期结果…'
        "
        @submit="send"
      />

      <div class="chat-actions">
        <Button v-if="awaitingPost" :disabled="busy" @click="send('确认只读 POST')">
          确认只读 POST
        </Button>
        <Button v-if="draft?.ready && isApi" variant="outline" @click="draftOpen = true">
          查看已验证草稿
        </Button>
      </div>

      <details v-if="rpaSteps.length" class="draft-result">
        <summary>查看 RPA 草案（待执行验证）</summary>
        <ol class="rpa-steps">
          <li v-for="(step, index) in rpaSteps" :key="index">
            <span class="rpa-order">{{ index + 1 }}</span>
            <span>{{ [step.action, step.target, step.expected].join(' · ') }}</span>
          </li>
        </ol>
      </details>

      <details v-if="draft?.ready && isApi" class="draft-result">
        <summary>查看流程草稿与试跑结果</summary>
        <pre>{{ JSON.stringify({ flow: draft.flow, preview: draft.preview }, null, 2) }}</pre>
      </details>

      <p class="feedback" role="status">{{ feedback }}</p>
    </Card>
  </section>
</template>
