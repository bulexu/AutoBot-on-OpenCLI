<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { api } from '@/ipc';
import type { ModelConfig, RuntimeStatus } from '@/ipc';

const config = ref<ModelConfig>({ base_url: '', model: '', hasAk: false });
const runtime = ref<RuntimeStatus | undefined>(undefined);
const baseUrl = ref('');
const model = ref('');
const ak = ref('');
const busy = ref(false);
const feedback = ref('');

async function load() {
  try {
    config.value = await api.getModelConfig();
    baseUrl.value = config.value.base_url;
    model.value = config.value.model;
    feedback.value = config.value.hasAk ? '模型配置已保存。' : '请保存模型配置。';
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : String(error);
  }
  try {
    runtime.value = await api.runtimeStatus();
  } catch {
    runtime.value = { ready: false };
  }
}

async function save() {
  if (busy.value) return;
  busy.value = true;
  feedback.value = '正在保存模型配置…';
  try {
    config.value = await api.saveModelConfig({
      base_url: baseUrl.value,
      model: model.value,
      ak: ak.value,
    });
    baseUrl.value = config.value.base_url;
    model.value = config.value.model;
    ak.value = '';
    feedback.value = config.value.hasAk ? '模型配置已保存。' : '请保存模型配置。';
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : String(error);
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <section class="view" aria-labelledby="settings-title">
    <div class="content-head">
      <div>
        <h1 id="settings-title">系统设置</h1>
        <p class="muted">配置设计 Agent 使用的模型服务。</p>
      </div>
    </div>

    <Card class="panel">
      <CardHeader>
        <CardTitle>LLM 配置</CardTitle>
      </CardHeader>
      <CardContent>
        <form autocomplete="off" @submit.prevent="save">
          <FieldGroup class="model-settings-fields">
            <Field>
              <FieldLabel for="base-url">Base URL</FieldLabel>
              <Input
                id="base-url"
                v-model="baseUrl"
                type="url"
                placeholder="https://api.openai.com/v1"
                spellcheck="false"
              />
            </Field>
            <Field>
              <FieldLabel for="model">Model</FieldLabel>
              <Input id="model" v-model="model" required />
            </Field>
            <Field>
              <FieldLabel for="ak">AK</FieldLabel>
              <Input
                id="ak"
                v-model="ak"
                type="password"
                :required="!config.hasAk"
                :placeholder="config.hasAk ? '已保存，留空保留当前 AK' : ''"
              />
              <FieldDescription>凭证加密保存在本机，不随流程包导出。</FieldDescription>
            </Field>
          </FieldGroup>
          <div class="actions">
            <Button type="submit" :disabled="busy">保存模型配置</Button>
            <span class="feedback" role="status">{{ feedback }}</span>
          </div>
        </form>
      </CardContent>
    </Card>

    <Card class="panel">
      <CardHeader>
        <CardTitle>运行环境</CardTitle>
      </CardHeader>
      <CardContent>
        <div class="runtime-setting">
          <strong>OpenCLI</strong>
          <Badge variant="outline" :data-state="runtime?.ready ? 'ready' : 'pending'">
            {{ runtime?.ready ? '已就绪' : runtime ? '未就绪' : '检查中' }}
          </Badge>
          <code v-if="runtime?.ready">{{ runtime.runtimeVersion }}</code>
        </div>
      </CardContent>
    </Card>
  </section>
</template>
