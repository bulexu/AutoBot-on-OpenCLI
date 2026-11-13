<script setup lang="ts">
import { computed, onMounted, onUnmounted, provide, ref } from 'vue';
import { TooltipProvider } from '@/components/ui/tooltip';
import AppSidebar from '@/components/app/AppSidebar.vue';
import DashboardView from '@/views/DashboardView.vue';
import FlowsView from '@/views/FlowsView.vue';
import SettingsView from '@/views/SettingsView.vue';
import FlowDesignGuideView from '@/views/FlowDesignGuideView.vue';
import { api } from '@/ipc';
import type { FlowStatus, RuntimeStatus } from '@/ipc';

const tabs = [
  { id: 'dashboard', label: '执行看板', icon: 'dashboard' },
  { id: 'flows', label: '工作流管理', icon: 'flows' },
  { id: 'workbench', label: 'Flow 设计说明', icon: 'workbench' },
  { id: 'settings', label: '系统设置', icon: 'settings' },
] as const;

type TabId = (typeof tabs)[number]['id'];

const tabIds = new Set<string>(tabs.map((tab) => tab.id));

function selectTab(next: string) {
  if (tabIds.has(next)) selectedTab.value = next as TabId;
}

const selectedTab = ref<TabId>('dashboard');
const flow = ref<FlowStatus>({});
const runtime = ref<RuntimeStatus | undefined>(undefined);
const busy = ref(false);
const status = ref('');

provide('flow', flow);
provide('runtime', runtime);
provide('busy', busy);
provide('status', status);

/**
 * Runs an action while showing progress in a feedback slot. The UI is disabled
 * for the duration, so the user cannot start a second run of the same flow.
 */
async function perform(action: () => Promise<void>, feedback: { value: string }, pending: string) {
  if (busy.value) return;
  busy.value = true;
  feedback.value = pending;
  try {
    await action();
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : String(error);
  } finally {
    busy.value = false;
  }
}

provide('perform', perform);

const view = computed(() => {
  switch (selectedTab.value) {
    case 'flows':
      return FlowsView;
    case 'workbench':
      return FlowDesignGuideView;
    case 'settings':
      return SettingsView;
    default:
      return DashboardView;
  }
});

onMounted(async () => {
  try {
    flow.value = await api.status();
  } catch (error) {
    status.value = error instanceof Error ? error.message : String(error);
  }
  try {
    runtime.value = await api.runtimeStatus();
  } catch {
    runtime.value = { ready: false };
  }
});

const onFocus = () => {
  /* Views refresh their own data when they become visible again. */
};
const onVisibility = () => {
  /* Views poll while the dashboard is visible. */
};
onMounted(() => {
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onVisibility);
});
onUnmounted(() => {
  window.removeEventListener('focus', onFocus);
  document.removeEventListener('visibilitychange', onVisibility);
});
</script>

<template>
  <TooltipProvider :delay-duration="200">
    <div class="app-shell">
      <AppSidebar :tabs="tabs" :active="selectedTab" :runtime="runtime" @select="selectTab" />
      <main class="app-content">
        <component :is="view" @open-flows="selectTab('flows')" />
      </main>
    </div>
  </TooltipProvider>
</template>
