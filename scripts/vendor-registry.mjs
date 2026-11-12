/**
 * Vendors the UI components used by the desktop renderer into the repository.
 *
 * The shadcn-vue and AI Elements Vue registries are plain JSON endpoints that
 * describe a component and the components it depends on. Rather than running
 * the registry CLI (which mutates package.json and rewrites imports), this
 * script resolves the dependency closure and writes the files verbatim, so the
 * vendored code stays auditable and reproducible.
 *
 * Usage: node scripts/vendor-registry.mjs
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'src/desktop/renderer/components');

/**
 * Only the vendored registry directories are rewritten. `components/app` holds
 * hand-written views and must survive a re-vendor.
 */
const vendored = ['ui', 'ai-elements'];
for (const name of vendored) {
  rmSync(join(target, name), { recursive: true, force: true });
}

const SHADCN = 'https://shadcn-vue.com/r/styles/default';
const ELEMENTS = 'https://registry.ai-elements-vue.com';

/**
 * Registry roots to vendor.
 *
 * The AI Elements set is deliberately narrow. `message` and `conversation`
 * upstream render assistant text as Markdown through `vue-stream-markdown`,
 * which pulls in KaTeX plus the Shiki highlighter and ~2 MB of language
 * grammars. The design agent answers in plain prose (`reply: z.string()` in
 * src/design/model.ts), so that renderer is dead weight here and the
 * components below are vendored without it.
 */
const roots = [
  // shadcn-vue primitives used across the workbench.
  'https://shadcn-vue.com/r/styles/default/button.json',
  'https://shadcn-vue.com/r/styles/default/card.json',
  'https://shadcn-vue.com/r/styles/default/input.json',
  'https://shadcn-vue.com/r/styles/default/textarea.json',
  'https://shadcn-vue.com/r/styles/default/label.json',
  'https://shadcn-vue.com/r/styles/default/select.json',
  'https://shadcn-vue.com/r/styles/default/badge.json',
  'https://shadcn-vue.com/r/styles/default/separator.json',
  'https://shadcn-vue.com/r/styles/default/scroll-area.json',
  'https://shadcn-vue.com/r/styles/default/dialog.json',
  'https://shadcn-vue.com/r/styles/default/tabs.json',
  'https://shadcn-vue.com/r/styles/default/table.json',
  'https://shadcn-vue.com/r/styles/default/tooltip.json',
  'https://shadcn-vue.com/r/styles/default/dropdown-menu.json',
  'https://shadcn-vue.com/r/styles/default/alert.json',
  'https://shadcn-vue.com/r/styles/default/skeleton.json',
  'https://shadcn-vue.com/r/styles/default/switch.json',
  'https://shadcn-vue.com/r/styles/default/collapsible.json',
  'https://shadcn-vue.com/r/styles/default/input-group.json',
  'https://shadcn-vue.com/r/styles/default/hover-card.json',
  'https://shadcn-vue.com/r/styles/default/command.json',
  'https://shadcn-vue.com/r/styles/default/avatar.json',
  'https://shadcn-vue.com/r/styles/default/button-group.json',
  'https://shadcn-vue.com/r/styles/default/progress.json',
  'https://shadcn-vue.com/r/styles/default/popover.json',
  'https://shadcn-vue.com/r/styles/default/sidebar.json',
  'https://shadcn-vue.com/r/styles/default/sheet.json',
  'https://shadcn-vue.com/r/styles/default/sonner.json',
  'https://shadcn-vue.com/r/styles/default/empty.json',
  'https://shadcn-vue.com/r/styles/default/field.json',
  // AI Elements Vue building blocks used by the design workbench.
  'https://registry.ai-elements-vue.com/conversation.json',
  'https://registry.ai-elements-vue.com/message.json',
  'https://registry.ai-elements-vue.com/prompt-input.json',
  'https://registry.ai-elements-vue.com/suggestion.json',
  'https://registry.ai-elements-vue.com/loader.json',
];

/**
 * Upstream files that are dropped after vendoring.
 *
 * The AI Elements `message` and `conversation` components are wired to the
 * Markdown renderer, which this app does not use — the design agent's replies
 * are plain text. Removing the renderer also removes its KaTeX, Shiki and
 * Mermaid dependencies from the bundle.
 */
const removed = [
  'ai-elements/message/MessageResponse.vue',
  'ai-elements/message/useMarkdownExtensions.ts',
  'ai-elements/reasoning/Reasoning.vue',
  'ai-elements/reasoning/ReasoningContent.vue',
  'ai-elements/reasoning/ReasoningTrigger.vue',
  'ai-elements/reasoning/context.ts',
  'ai-elements/reasoning/index.ts',
  'ai-elements/shimmer/Shimmer.vue',
  'ai-elements/shimmer/index.ts',
];

/**
 * Rewrites applied to individual upstream files so the vendored copy drops the
 * Markdown renderer without changing its public API.
 */
const adaptations = {
  'ai-elements/conversation/Conversation.vue': (source) =>
    source
      .replace(/import \{ MarkdownProvider \} from 'vue-stream-markdown'\n/, '')
      .replace(/import \{ useMarkdownExtensions \} from '[^']*'\n/, '')
      .replace(/const \{ provider, extensions \} = useMarkdownExtensions\(\)\n/, '')
      .replace(
        /    <MarkdownProvider v-if="!provider" :extensions="extensions">\n      <slot \/>\n    <\/MarkdownProvider>\n    <slot v-else \/>/,
        '    <slot />',
      ),
  // The barrels export every file in the directory, so the removed Markdown
  // renderer has to be dropped from them as well.
  'ai-elements/message/index.ts': (source) =>
    source
      .replace(/^export .*MessageResponse.*$/m, '')
      .replace(/^export .*MessageToolbar.*$/m, ''),
};

const resolved = new Map();
const queue = [...roots];

while (queue.length) {
  const url = queue.shift();
  if (resolved.has(url)) continue;
  const response = await fetch(url);
  if (!response.ok) {
    console.error(`MISS ${url} (${response.status})`);
    continue;
  }
  const item = await response.json();
  resolved.set(url, item);
  for (const dependency of item.registryDependencies ?? []) {
    queue.push(dependency.startsWith('http') ? dependency : `${SHADCN}/${dependency}.json`);
  }
}

let written = 0;
for (const item of resolved.values()) {
  for (const file of item.files ?? []) {
    if (!file.content) continue;
    // shadcn-vue publishes under `ui/…`; AI Elements publishes under
    // `components/ai-elements/…`. Both are rooted at the components directory,
    // so the leading `components/` segment is dropped to avoid nesting twice.
    const relative = file.path.replace(/^components\//, '');
    if (removed.includes(relative)) continue;
    // The sidebar component imports its siblings through the registry's own
    // `@/registry/default/ui/…` path; point those at the vendored location.
    let content = file.content.replace(
      /@\/registry\/default\/ui\//g,
      '@/components/ui/',
    );
    const adapt = adaptations[relative];
    if (adapt) content = adapt(content);
    const destination = join(target, relative);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, content);
    written += 1;
  }
}

console.log(`vendored ${resolved.size} registry items, ${written} files into ${target}`);
