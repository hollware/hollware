<script setup lang="ts">
import { computed } from 'vue'
import { useMessages } from '../i18n/index.ts'
import { impactLines, type Impact, type Problem } from '../lib/structure.ts'

const props = defineProps<{
  impact: Impact | null
  problems: readonly Problem[]
  conflict: boolean
  failure: string | null
}>()
const emit = defineEmits<{ confirm: []; cancel: []; reload: [] }>()

const m = useMessages()
const lines = computed(() =>
  props.impact === null ? [] : impactLines(props.impact, m.value.structure),
)
const open = computed({
  get: () => props.impact !== null,
  set: (value) => {
    if (!value) emit('cancel')
  },
})
</script>

<template>
  <UAlert
    v-if="failure !== null"
    color="error"
    :title="m.structure.notSaved"
    :description="failure"
  />
  <UAlert v-if="problems.length > 0" color="error" :title="m.structure.fixFirst">
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
    :title="m.structure.conflictTitle"
    :description="m.structure.conflictBody"
    :actions="[{ label: m.structure.loadAgain, onClick: () => emit('reload') }]"
  />
  <UModal v-model:open="open" :title="m.structure.impactTitle">
    <template #body>
      <ul class="list-disc space-y-2 pl-5 text-sm">
        <li v-for="line in lines" :key="line">{{ line }}</li>
      </ul>
      <p class="mt-3 text-sm text-muted">{{ m.structure.noDelete }}</p>
    </template>
    <template #footer>
      <UButton :label="m.common.cancel" variant="ghost" @click="emit('cancel')" />
      <UButton :label="m.structure.applyAnyway" color="warning" @click="emit('confirm')" />
    </template>
  </UModal>
</template>
