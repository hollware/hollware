<script setup lang="ts">
/**
 * What an agent sees when it writes to Hollware: a draft that breaks a contract is saved anyway,
 * with the fix; the fixed draft passes; publishing makes it live. The words are Hollware's own.
 */
const lines = [
  { kind: 'call', text: 'create_draft', arg: 'blog / en / hello-world' },
  { kind: 'out', text: 'saved · version 1 · verdict: 1 error' },
  { kind: 'err', text: '/frontmatter/description  is 212 characters, at most 160' },
  { kind: 'fix', text: 'fix: shorten the description to 160 characters or fewer' },
  { kind: 'call', text: 'update_draft', arg: 'version 1' },
  { kind: 'ok', text: 'saved · version 2 · verdict: ok' },
  { kind: 'call', text: 'publish', arg: 'version 2' },
  { kind: 'ok', text: 'published · live on the site' },
] as const
</script>

<template>
  <div
    class="relative overflow-hidden rounded-lg border border-default bg-muted/80 text-left shadow-2xl shadow-black/40"
  >
    <div class="flex items-center gap-2 border-b border-default px-4 py-3">
      <span class="size-2.5 rounded-full bg-(--ui-border-accented)" />
      <span class="size-2.5 rounded-full bg-(--ui-border-accented)" />
      <span class="size-2.5 rounded-full bg-(--ui-border-accented)" />
      <span class="ml-3 font-mono text-xs text-dimmed">agent → hollware /mcp</span>
    </div>
    <ol class="space-y-1.5 p-5 font-mono text-[13px] leading-relaxed">
      <li v-for="(line, index) in lines" :key="index" class="flex gap-3">
        <template v-if="line.kind === 'call'">
          <span class="text-primary">›</span>
          <span class="text-highlighted">{{ line.text }}</span>
          <span class="text-dimmed">{{ line.arg }}</span>
        </template>
        <template v-else>
          <span class="w-3" />
          <span
            :class="{
              'text-muted': line.kind === 'out',
              'text-error': line.kind === 'err',
              'text-warning': line.kind === 'fix',
              'text-primary': line.kind === 'ok',
            }"
            >{{ line.text }}</span
          >
        </template>
      </li>
    </ol>
  </div>
</template>
