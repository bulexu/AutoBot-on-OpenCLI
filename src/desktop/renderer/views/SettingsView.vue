<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/ipc';
import type { RuntimeStatus } from '@/ipc';

const runtime = ref<RuntimeStatus>();

const checking = ref(false);
async function refresh() {
  if (checking.value) return;
  checking.value = true;
  try {
    runtime.value = await api.runtimeStatus(true);
  } catch {
    runtime.value = { ready: false };
  } finally {
    checking.value = false;
  }
}
onMounted(refresh);
</script>

<template>
  <section class="view" aria-labelledby="settings-title">
    <div class="content-head">
      <div>
        <h1 id="settings-title">系统设置</h1>
        <p class="muted">查看流程执行所需的本地运行环境。</p>
      </div>
    </div>

    <Card class="panel">
      <CardHeader>
        <div class="flex items-center justify-between gap-3">
          <CardTitle>运行环境</CardTitle>
          <Button variant="outline" size="sm" :disabled="checking" @click="refresh">
            {{ checking ? '检查中…' : '重新检查' }}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div class="runtime-setting">
          <strong>内置 OpenCLI</strong>
          <Badge variant="outline" :data-state="runtime?.ready ? 'ready' : 'pending'">
            {{ runtime?.ready ? '已就绪' : runtime ? '未就绪' : '检查中' }}
          </Badge>
          <code v-if="runtime?.ready">{{ runtime.runtimeVersion }}</code>
        </div>
        <p v-if="runtime?.browserError" class="muted mt-3" role="status">
          {{ runtime.browserError }}
        </p>
        <div v-if="runtime?.browser" class="mt-4 grid gap-2 border-t pt-4">
          <div class="runtime-setting">
            <strong>浏览器适配</strong>
            <Badge variant="outline" :data-state="runtime.browser.ready ? 'ready' : 'pending'">
              {{ runtime.browser.ready ? '已就绪' : '待处理' }}
            </Badge>
          </div>
          <p>
            守护进程 · {{ runtime.browser.daemonRunning ? '运行中' : '未运行' }}
            {{ runtime.browser.daemonVersion
            }}{{ runtime.browser.daemonStale ? '（版本不一致）' : '' }}
          </p>
          <p>
            浏览器扩展 · {{ runtime.browser.extensionConnected ? '已连接' : '未连接' }}
            {{ runtime.browser.extensionVersion
            }}{{
              runtime.browser.incompatible
                ? '（不兼容）'
                : runtime.browser.extensionOutdated
                  ? '（建议更新）'
                  : ''
            }}
          </p>
          <p>浏览器连通性 · {{ runtime.browser.connectivityOk ? '通过' : '未通过' }}</p>
          <ul
            v-if="runtime.browser.issues.length"
            class="list-disc space-y-2 pl-5 text-muted-foreground"
          >
            <li
              v-for="issue in runtime.browser.issues"
              :key="issue"
              class="whitespace-pre-line break-words"
            >
              {{ issue }}
            </li>
          </ul>
        </div>
      </CardContent>
    </Card>
  </section>
</template>
