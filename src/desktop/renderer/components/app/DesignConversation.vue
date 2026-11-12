<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { Sparkles } from '@lucide/vue';
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { Message, MessageContent } from '@/components/ai-elements/message';
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from '@/components/ai-elements/prompt-input';
import { Suggestion } from '@/components/ai-elements/suggestion';
import { Loader } from '@/components/ai-elements/loader';

interface ChatMessage {
  role: 'user' | 'agent';
  text: string;
}

const props = defineProps<{
  messages: ChatMessage[];
  busy: boolean;
  starters: string[];
  placeholder: string;
}>();

const emit = defineEmits<{ submit: [text: string] }>();

const prompt = ref<InstanceType<typeof PromptInput> | undefined>(undefined);

const status = computed(() => (props.busy ? 'submitted' : 'ready'));

async function focus() {
  await nextTick();
  prompt.value?.$el?.querySelector('textarea')?.focus();
}

defineExpose({ focus });

function onSubmit(payload: { text: string }) {
  if (!payload.text.trim()) return;
  emit('submit', payload.text);
}
</script>

<template>
  <div class="design-chat">
    <Conversation class="design-conversation" aria-label="与设计 Agent 的对话">
      <ConversationContent class="design-transcript">
        <Message
          v-for="(message, index) in messages"
          :key="index"
          :from="message.role === 'user' ? 'user' : 'assistant'"
        >
          <div v-if="message.role !== 'user'" class="ai-avatar" aria-hidden="true">
            <Sparkles class="size-3.5" />
          </div>
          <MessageContent class="ai-message-content">
            <span class="ai-role">{{ message.role === 'user' ? '你' : '设计 Agent' }}</span>
            <p class="ai-text">{{ message.text }}</p>
          </MessageContent>
        </Message>

        <Message v-if="busy" from="assistant">
          <div class="ai-avatar" aria-hidden="true">
            <Sparkles class="size-3.5" />
          </div>
          <MessageContent class="ai-message-content">
            <span class="ai-role">设计 Agent</span>
            <p class="ai-text ai-working">
              <Loader :size="14" class="inline-block align-[-2px]" />
              正在处理你的消息…
            </p>
          </MessageContent>
        </Message>

        <div v-if="messages.length === 1 && !busy" class="ai-starters">
          <Suggestion
            v-for="starter in starters"
            :key="starter"
            :suggestion="starter"
            @click="emit('submit', starter)"
          />
        </div>
      </ConversationContent>
      <ConversationScrollButton class="ai-scroll-button" />
    </Conversation>

    <PromptInput ref="prompt" class="ai-prompt" :disabled="busy" @submit="onSubmit">
      <PromptInputBody>
        <PromptInputTextarea
          class="ai-textarea"
          :placeholder="placeholder"
          :disabled="busy"
          aria-label="发给设计 Agent 的消息"
        />
      </PromptInputBody>
      <PromptInputFooter>
        <span class="ai-hint">Enter 发送 · Shift + Enter 换行</span>
        <PromptInputSubmit :status="status" :disabled="busy" />
      </PromptInputFooter>
    </PromptInput>
  </div>
</template>
