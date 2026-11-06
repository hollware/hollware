<script setup lang="ts">
import type { NavigationEntry } from '@hollware/nuxt'

const props = defineProps<{ entries: readonly NavigationEntry[]; current: string }>()

function holds(entry: NavigationEntry): boolean {
  return entry.slug === props.current || entry.children.some(holds)
}
</script>

<template>
  <ul>
    <li v-for="entry in props.entries" :key="entry.slug">
      <details v-if="entry.children.length > 0" :open="holds(entry)">
        <summary>
          <NuxtLink
            :to="entry.path ?? ''"
            :aria-current="entry.slug === props.current ? 'page' : undefined"
            >{{ entry.title }}</NuxtLink
          >
        </summary>
        <HelpTree :entries="entry.children" :current="props.current" />
      </details>
      <NuxtLink
        v-else
        :to="entry.path ?? ''"
        :aria-current="entry.slug === props.current ? 'page' : undefined"
        >{{ entry.title }}</NuxtLink
      >
    </li>
  </ul>
</template>
