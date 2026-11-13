<script setup lang="ts">
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

defineEmits<{ openFlows: [] }>();
</script>

<template>
  <section class="view" aria-labelledby="flow-design-title">
    <div class="content-head">
      <div>
        <h1 id="flow-design-title">Flow 设计说明</h1>
        <p class="muted">在本地 AI 工具中设计 API Flow，再导入 Autobot 试跑和执行。</p>
      </div>
    </div>

    <div class="grid max-w-3xl gap-4">
      <Card>
        <CardHeader><CardTitle>安装设计技能</CardTitle></CardHeader>
        <CardContent class="grid gap-3">
          <p>
            准备一份包含
            <code>skills/autobot-flow-designer/</code>
            的 Autobot 源码，以及 Node.js 24 或更新版本。在源码根目录运行
            <code>npm ci</code>
            安装校验和打包所需的依赖。
          </p>
          <p>
            把 <code>autobot-flow-designer</code> 整个目录复制到 AI 工具的技能目录。 在 Codex
            中，可将它放到项目的 <code>.agents/skills/</code> 下。
          </p>
          <p>重新加载 AI 工具，并让它访问这份 Autobot 源码。</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>生成流程包</CardTitle></CardHeader>
        <CardContent class="grid gap-3">
          <p>
            在 Codex 中调用 <code>$autobot-flow-designer</code>。 在其他支持 Agent Skills
            的工具中，选择或调用同名技能。
          </p>
          <p>
            提供业务目标、脱敏的 cURL 和响应样例，以及目标表字段和唯一键。
            如果涉及分页、缺数处理或汇总，一并说明规则。实际凭证在 Autobot 内绑定。
          </p>
          <p>技能会输出可编辑的 JSON 定义，并用 Autobot 的校验器打包为可导入的 .flow 文件。</p>
          <p class="muted">当前技能支持 API Flow。可执行的浏览器 RPA Flow 计划在 P3 支持。</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>导入并试跑</CardTitle></CardHeader>
        <CardContent class="grid justify-items-start gap-3">
          <p>
            在工作流管理中导入
            .flow，绑定凭证和目标表并填写动态参数。先运行只读预览，核对字段和结果后再正式执行。
          </p>
          <Button type="button" @click="$emit('openFlows')">打开工作流管理</Button>
        </CardContent>
      </Card>
    </div>
  </section>
</template>
