<script setup lang="ts">
const slots = useSlots()
const { m } = useLocale()
const compact = inject('install-compact', false)
const tab = ref<'claude' | 'codex' | 'cursor' | 'other'>('claude')
const copied = ref(false)
const prompt = () => textOfVNodes(slots.default?.()).replace(/\s+/g, ' ').trim()
const quoted = () => `"${prompt().replace(/(["\\$`])/g, '\\$1')}"`

const COMMANDS = {
  claude: (text: string) => `claude ${text}`,
  codex: (text: string) => `codex ${text}`,
} as const

function shownFor(): string {
  return tab.value === 'claude' || tab.value === 'codex' ? COMMANDS[tab.value](quoted()) : prompt()
}

async function copy() {
  try {
    await navigator.clipboard.writeText(shownFor())
    copied.value = true
    setTimeout(() => (copied.value = false), 1800)
  } catch {
    copied.value = false
  }
}

const tabs = computed(() =>
  (['claude', 'codex', 'cursor', 'other'] as const).map((value) => ({
    value,
    label: m.value.pages.install[value],
  })),
)
</script>

<template>
  <div class="max-w-xl">
    <div class="flex flex-wrap items-center gap-3">
      <UButton
        color="secondary"
        size="xl"
        :icon="copied ? 'i-lucide-check' : 'i-lucide-sparkles'"
        :label="copied ? m.pages.install.copied : m.pages.install.button"
        @click="copy"
      />
      <div v-if="!compact" class="flex gap-1" role="tablist" :aria-label="m.pages.install.agents">
        <UButton
          v-for="item in tabs"
          :key="item.value"
          role="tab"
          size="xs"
          :aria-selected="tab === item.value"
          :variant="tab === item.value ? 'soft' : 'ghost'"
          color="neutral"
          :label="item.label"
          @click="tab = item.value"
        />
      </div>
    </div>
    <p v-if="compact" class="sr-only">{{ prompt() }}</p>
    <p v-if="!compact" class="mt-4 text-xs text-dimmed">
      {{ tab === 'claude' || tab === 'codex' ? m.pages.install.terminal : m.pages.install.paste }}
    </p>
    <pre
      v-if="!compact"
      class="mt-2 overflow-x-auto rounded-lg border border-default bg-muted/60 px-4 py-3 font-mono text-[13px] leading-relaxed whitespace-pre-wrap text-highlighted"
      >{{ shownFor() }}</pre>
    <div v-if="$slots.note" class="mt-4 text-sm text-muted landing-copy">
      <slot name="note" />
    </div>
  </div>
</template>
