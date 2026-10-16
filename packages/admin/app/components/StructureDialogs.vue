<script setup lang="ts">
import { computed } from 'vue'
import { impactLines, type Impact, type Problem } from '../lib/structure.ts'

/** The answers of a change of the structure that need the person: confirm, fix, reload. */
const props = defineProps<{
  impact: Impact | null
  problems: readonly Problem[]
  conflict: boolean
  failure: string | null
}>()
const emit = defineEmits<{ confirm: []; cancel: []; reload: [] }>()

const lines = computed(() => (props.impact === null ? [] : impactLines(props.impact)))
const open = computed({
  get: () => props.impact !== null,
  set: (value) => {
    if (!value) emit('cancel')
  },
})
</script>

<template>
  <UAlert v-if="failure !== null" color="error" title="Not saved" :description="failure" />
  <UAlert v-if="problems.length > 0" color="error" title="Not saved: fix these first">
    <template #description>
      <ul class="mt-1 space-y-1">
        <li v-for="(problem, index) in problems" :key="index">
          <span class="font-mono text-xs">{{ problem.path }}</span> — {{ problem.message }}.
          {{ problem.fix }}
        </li>
      </ul>
    </template>
  </UAlert>
  <UAlert
    v-if="conflict"
    color="warning"
    title="Someone changed the structure since you opened it"
    description="Load it again and redo your change."
    :actions="[{ label: 'Load again', onClick: () => emit('reload') }]"
  />
  <UModal v-model:open="open" title="This change touches existing entries">
    <template #body>
      <ul class="list-disc space-y-2 pl-5 text-sm">
        <li v-for="line in lines" :key="line">{{ line }}</li>
      </ul>
      <p class="mt-3 text-sm text-muted">No entry is deleted.</p>
    </template>
    <template #footer>
      <UButton label="Cancel" variant="ghost" @click="emit('cancel')" />
      <UButton label="Apply anyway" color="warning" @click="emit('confirm')" />
    </template>
  </UModal>
</template>
