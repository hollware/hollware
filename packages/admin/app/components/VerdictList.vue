<script setup lang="ts">
import type { schemas } from '@hollware/core'
import type * as z from 'zod'

defineProps<{ verdict: z.output<typeof schemas.verdict> | null }>()
</script>

<template>
  <section v-if="verdict !== null" aria-label="Contracts">
    <p
      v-if="verdict.errors.length === 0 && verdict.warnings.length === 0"
      class="text-sm text-success"
    >
      Every contract passes.
    </p>
    <ul class="space-y-2">
      <li
        v-for="(violation, index) in [...verdict.errors, ...verdict.warnings]"
        :key="index"
        class="rounded border p-2 text-sm"
        :class="violation.severity === 'error' ? 'border-error' : 'border-warning'"
      >
        <UBadge
          :label="violation.severity"
          :color="violation.severity === 'error' ? 'error' : 'warning'"
          variant="subtle"
          size="sm"
        />
        <span class="ml-2 font-mono text-xs text-muted">{{ violation.contract }}</span>
        <span v-if="violation.line !== undefined" class="ml-1 text-xs text-muted">
          line {{ violation.line }}
        </span>
        <p class="mt-1">{{ violation.message }}</p>
        <p class="text-muted">{{ violation.fix }}</p>
      </li>
    </ul>
  </section>
</template>
