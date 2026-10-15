<script setup lang="ts">
// The `callout` component of the docs collection, as the docs show it.
const props = withDefaults(defineProps<{ type?: 'note' | 'tip' | 'warning' }>(), { type: 'note' })

const LOOK = {
  note: { color: 'neutral', icon: 'i-lucide-info', title: 'Note' },
  tip: { color: 'primary', icon: 'i-lucide-lightbulb', title: 'Tip' },
  warning: { color: 'warning', icon: 'i-lucide-triangle-alert', title: 'Warning' },
} as const

const look = computed(() => LOOK[props.type] ?? LOOK.note)
</script>

<template>
  <UAlert :color="look.color" variant="subtle" :icon="look.icon" :title="look.title" class="my-6">
    <template #description><slot /></template>
  </UAlert>
</template>
