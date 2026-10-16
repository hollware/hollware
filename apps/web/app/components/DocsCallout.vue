<script setup lang="ts">
// The `callout` component of the docs collection, as the docs show it.
const props = withDefaults(defineProps<{ type?: 'note' | 'tip' | 'warning' }>(), { type: 'note' })
const { m } = useLocale()

const LOOK = {
  note: { color: 'neutral', icon: 'i-lucide-info' },
  tip: { color: 'primary', icon: 'i-lucide-lightbulb' },
  warning: { color: 'warning', icon: 'i-lucide-triangle-alert' },
} as const

const type = computed(() => (props.type in LOOK ? props.type : 'note'))
const look = computed(() => LOOK[type.value])
</script>

<template>
  <UAlert
    :color="look.color"
    variant="subtle"
    :icon="look.icon"
    :title="m.docs.callout[type]"
    class="my-6"
  >
    <template #description><slot /></template>
  </UAlert>
</template>
