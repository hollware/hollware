<script setup lang="ts">
const props = defineProps<{ command: string }>()
const { m } = useLocale()
const copied = ref(false)

async function copy() {
  try {
    await navigator.clipboard.writeText(props.command)
    copied.value = true
    setTimeout(() => (copied.value = false), 1600)
  } catch {
    copied.value = false
  }
}
</script>

<template>
  <div
    class="group inline-flex items-center gap-3 rounded-lg border border-default bg-muted/60 py-2 pr-2 pl-4 font-mono text-sm shadow-[0_0_0_1px_rgb(255_255_255/0.02)_inset]"
  >
    <span class="text-primary select-none">$</span>
    <span class="text-highlighted">{{ command }}</span>
    <UButton
      :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
      :aria-label="copied ? m.copy.copied : m.copy.copy"
      color="neutral"
      variant="ghost"
      size="xs"
      @click="copy"
    />
  </div>
</template>
