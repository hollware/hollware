<script setup lang="ts">
import { computed } from 'vue'
import { useMessages } from '../i18n/index.ts'

const open = defineModel<boolean>('open', { required: true })
const m = useMessages()

const groups = computed(() => {
  const s = m.value.shortcuts
  return [
    {
      label: s.everywhere,
      items: [
        { label: s.search, keys: ['meta', 'k'] },
        { label: s.newEntry, keys: ['c'] },
        { label: s.goHome, keys: ['g', 'h'] },
        { label: s.goEntries, keys: ['g', 'e'] },
        { label: s.goReviews, keys: ['g', 'r'] },
        { label: s.goImages, keys: ['g', 'i'] },
        { label: s.goSettings, keys: ['g', 's'] },
        { label: s.help, keys: ['?'] },
      ],
    },
    {
      label: s.lists,
      items: [
        { label: s.next, keys: ['j'] },
        { label: s.previous, keys: ['k'] },
        { label: s.select, keys: ['x'] },
        { label: s.clear, keys: ['escape'] },
      ],
    },
    {
      label: s.entry,
      items: [
        { label: s.save, keys: ['meta', 's'] },
        { label: s.markdown, keys: ['meta', 'shift', 'm'] },
        { label: s.history, keys: ['meta', 'shift', 'h'] },
        { label: s.properties, keys: ['meta', 'shift', 'i'] },
        { label: s.blocks, keys: ['/'] },
        { label: s.bold, keys: ['meta', 'b'] },
        { label: s.italic, keys: ['meta', 'i'] },
      ],
    },
  ]
})
</script>

<template>
  <UModal v-model:open="open" :title="m.shortcuts.title">
    <template #body>
      <div class="space-y-6">
        <section v-for="group in groups" :key="group.label" :aria-label="group.label">
          <h3 class="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
            {{ group.label }}
          </h3>
          <dl class="space-y-1.5 text-sm">
            <div
              v-for="item in group.items"
              :key="item.label"
              class="flex items-center justify-between"
            >
              <dt>{{ item.label }}</dt>
              <dd class="flex gap-1">
                <UKbd v-for="key in item.keys" :key="key" :value="key" />
              </dd>
            </div>
          </dl>
        </section>
      </div>
    </template>
  </UModal>
</template>
