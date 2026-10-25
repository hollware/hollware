<script setup lang="ts">
import type { schemas } from '@hollware/core'
import type * as z from 'zod'
import { useMessages } from '../i18n/index.ts'
import { explain } from '../lib/verdict-text.ts'

defineProps<{ verdict: z.output<typeof schemas.verdict> | null }>()
const m = useMessages()
</script>

<template>
  <section v-if="verdict !== null" :aria-label="m.verdict.label">
    <p
      v-if="verdict.errors.length === 0 && verdict.warnings.length === 0"
      class="text-sm text-success"
    >
      {{ m.verdict.allPass }}
    </p>
    <ul class="space-y-2">
      <li
        v-for="(violation, index) in [...verdict.errors, ...verdict.warnings]"
        :key="index"
        class="rounded border p-2 text-sm"
        :class="violation.severity === 'error' ? 'border-error' : 'border-warning'"
      >
        <UBadge
          :label="m.severity[violation.severity]"
          :color="violation.severity === 'error' ? 'error' : 'warning'"
          variant="subtle"
          size="sm"
        />
        <span class="ml-2 font-mono text-xs text-muted">{{ violation.contract }}</span>
        <span v-if="violation.line !== undefined" class="ml-1 text-xs text-muted">
          {{ m.verdict.line(violation.line) }}
        </span>
        <p class="mt-1">{{ explain(violation, m.verdictTexts).message }}</p>
        <p class="text-muted">{{ explain(violation, m.verdictTexts).fix }}</p>
      </li>
    </ul>
  </section>
</template>
