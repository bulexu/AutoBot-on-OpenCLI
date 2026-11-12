<script setup lang="ts">
import { LayoutDashboard, Settings, WandSparkles, Workflow, type LucideIcon } from '@lucide/vue';
import { computed } from 'vue';
import { Badge } from '@/components/ui/badge';
import type { RuntimeStatus } from '@/ipc';

const props = defineProps<{
  tabs: readonly { id: string; label: string; icon: string }[];
  active: string;
  runtime?: RuntimeStatus;
}>();

const emit = defineEmits<{ select: [id: string] }>();

const icons: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  flows: Workflow,
  workbench: WandSparkles,
  settings: Settings,
};

const runtimeState = computed(() => {
  if (!props.runtime) return 'checking';
  return props.runtime.ready ? 'ready' : 'failed';
});

const runtimeText = computed(() => {
  if (!props.runtime) return '检查中';
  return props.runtime.ready ? '已就绪' : '未就绪';
});
</script>

<template>
  <aside class="app-sidebar">
    <div class="sidebar-brand">
      <span class="brand-mark" aria-hidden="true">A</span>
      <span class="brand-name">Autobot</span>
    </div>

    <nav class="sidebar-nav" role="tablist" aria-label="客户端导航">
      <button
        v-for="tab in tabs"
        :id="`tab-${tab.id}`"
        :key="tab.id"
        type="button"
        role="tab"
        :aria-controls="tab.id"
        :aria-selected="tab.id === active"
        :tabindex="tab.id === active ? 0 : -1"
        :data-state="tab.id === active ? 'active' : 'inactive'"
        @click="emit('select', tab.id)"
      >
        <component :is="icons[tab.icon]" class="sidebar-icon" aria-hidden="true" />
        <span>{{ tab.label }}</span>
      </button>
    </nav>

    <div class="sidebar-foot">
      <Badge
        class="runtime-chip"
        :data-state="runtimeState"
        variant="outline"
        role="status"
        :aria-label="`OpenCLI ${runtimeText}`"
        :title="['OpenCLI', runtime?.runtimeVersion, runtimeText].filter(Boolean).join(' ')"
      >
        <span class="signal" aria-hidden="true"></span>
        <span class="runtime-label">{{ runtimeText }}</span>
      </Badge>
    </div>
  </aside>
</template>
