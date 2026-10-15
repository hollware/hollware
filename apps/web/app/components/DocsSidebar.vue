<script setup lang="ts">
import type { DocLink } from '~/utils/docs'

const props = defineProps<{ pages: readonly DocLink[] }>()

// The sections in their order; the reference ends with the tools, which the site generates.
const groups = computed(() =>
  SECTIONS.map((section) => ({
    label: section.label,
    items: [
      ...props.pages
        .filter((page) => page.section === section.key)
        .map((page) => ({ label: page.title, to: page.to })),
      ...(section.key === 'reference' ? [{ label: 'MCP tools', to: '/reference/mcp-tools/' }] : []),
    ],
  })).filter((group) => group.items.length > 0),
)
</script>

<template>
  <nav aria-label="Documentation" class="space-y-7">
    <div v-for="group in groups" :key="group.label">
      <p class="mb-2 px-2.5 text-xs font-medium tracking-wide text-dimmed uppercase">
        {{ group.label }}
      </p>
      <UNavigationMenu :items="group.items" orientation="vertical" highlight color="primary" />
    </div>
  </nav>
</template>
