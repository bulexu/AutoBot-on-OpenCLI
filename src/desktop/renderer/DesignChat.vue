<script setup>
import { computed, ref } from 'vue';
import Conversation from './elements/Conversation.vue';
import Message from './elements/Message.vue';
import MessageContent from './elements/MessageContent.vue';
import PromptInput from './elements/PromptInput.vue';

const props = defineProps({ state: { type: Object, required: true } });
const emit = defineEmits(['submit']);
const prompt = ref();
const starters = computed(() =>
  props.state.mode === 'rpa'
    ? ['从后台页面导出订单列表', '在浏览器里批量填写表单']
    : ['把订单 API 的数据同步到飞书多维表格', '从分页 API 读取记录并映射字段'],
);
defineExpose({ focus: () => prompt.value?.focus() });
</script>

<template>
  <Conversation aria-label="与设计 Agent 的对话">
    <div class="ai-transcript">
      <Message v-for="(message, index) in state.messages" :key="index" :from="message.role">
        <div v-if="message.role !== 'user'" class="ai-avatar" aria-hidden="true">✦</div>
        <MessageContent>
          <span class="ai-role">{{ message.role === 'user' ? '你' : '设计 Agent' }}</span>
          <p>{{ message.text }}</p>
        </MessageContent>
      </Message>
      <Message v-if="state.busy" from="assistant">
        <MessageContent><p class="ai-working">正在处理你的消息…</p></MessageContent>
      </Message>
      <div v-if="state.messages.length === 1 && !state.busy" class="ai-starters">
        <button
          v-for="starter in starters"
          :key="starter"
          type="button"
          @click="prompt.insert(starter)"
        >
          {{ starter }}
        </button>
      </div>
    </div>
  </Conversation>
  <PromptInput
    ref="prompt"
    :busy="state.busy"
    :placeholder="
      state.mode === 'rpa'
        ? '描述目标页面、操作和预期结果…'
        : '描述同步目标，或粘贴 cURL 和脱敏 JSON…'
    "
    @submit="emit('submit', $event.text)"
  />
</template>
