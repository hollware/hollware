<script setup lang="ts">
const slots = useSlots()
const { m } = useLocale()
const copied = ref(false)

async function copy() {
  try {
    await navigator.clipboard.writeText(textOfVNodes(slots.default?.()).trim())
    copied.value = true
    setTimeout(() => (copied.value = false), 1600)
  } catch {
    copied.value = false
  }
}
</script>

<template>
  <div class="not-prose my-6 rounded-xl border border-default bg-elevated/40 p-5">
    <div class="flex items-center justify-between gap-4">
      <p class="font-mono text-xs tracking-wide text-secondary uppercase"><slot name="label" /></p>
      <UButton
        size="xs"
        color="neutral"
        variant="outline"
        :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
        :label="copied ? m.pages.copiedText : m.pages.copyText"
        @click="copy"
      />
    </div>
    <div class="mt-3 text-[15px] leading-relaxed text-default landing-copy">
      <slot />
    </div>
  </div>
</template>
