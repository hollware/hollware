<script setup lang="ts">
import type { DocLink } from '~/utils/docs'

const props = defineProps<{ pages: readonly DocLink[] }>()
const { m, to } = useLocale()

const groups = computed(() =>
  SECTIONS.map((section) => ({
    label: m.value.docs.sections[section],
    items: [
      ...props.pages
        .filter((page) => page.section === section)
        .map((page) => ({ label: page.title, to: page.to })),
      ...(section === 'reference'
        ? [
            { label: m.value.tools.title, to: to('/reference/mcp-tools/') },
            { label: m.value.readApi.title, to: to('/reference/read-api/') },
            { label: m.value.events.title, to: to('/reference/events/') },
          ]
        : []),
    ],
  })).filter((group) => group.items.length > 0),
)
</script>

<template>
  <nav :aria-label="m.docs.navigation" class="space-y-7">
    <div v-for="group in groups" :key="group.label">
      <p class="mb-2 px-2.5 text-xs font-medium tracking-wide text-dimmed uppercase">
        {{ group.label }}
      </p>
      <UNavigationMenu :items="group.items" orientation="vertical" highlight color="primary" />
    </div>
  </nav>
</template>
