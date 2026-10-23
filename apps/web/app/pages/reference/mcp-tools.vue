<script setup lang="ts">
import { OPERATIONS } from '@hollware/core'
import * as z from 'zod'

const tools = OPERATIONS.map((operation) => ({
  name: operation.name,
  title: operation.title,
  description: operation.description,
  scopes: [...operation.scopes],
  effect: operation.effect,
  input: JSON.stringify(z.toJSONSchema(operation.input, { io: 'input' }), null, 2),
})).sort((a, b) => a.name.localeCompare(b.name))

const { locale, m } = useLocale()
const pages = await useDocsPages(locale.value)

useSeoMeta({
  title: () => m.value.tools.title,
  description: () => m.value.tools.description,
})
</script>

<template>
  <UContainer>
    <div class="grid gap-10 py-10 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside class="hidden lg:block">
        <div class="sticky top-[calc(var(--ui-header-height)+2.5rem)]">
          <DocsSidebar :pages="pages" />
        </div>
      </aside>
      <article class="min-w-0">
        <p class="font-mono text-xs text-primary">{{ m.docs.sections.reference }}</p>
        <h1 class="mt-2 text-4xl font-semibold tracking-tight text-highlighted">
          {{ m.tools.title }}
        </h1>
        <p class="mt-3 max-w-2xl text-lg text-muted">{{ m.tools.intro(tools.length) }}</p>
        <p v-if="m.tools.untranslated" class="mt-2 max-w-2xl text-sm text-dimmed">
          {{ m.tools.untranslated }}
        </p>
        <USeparator class="my-8" />
        <section
          v-for="tool in tools"
          :id="tool.name"
          :key="tool.name"
          class="scroll-mt-24 py-8 first:pt-0"
        >
          <div class="flex flex-wrap items-center gap-3">
            <h2 class="font-mono text-lg text-highlighted">{{ tool.name }}</h2>
            <UBadge
              :label="tool.effect"
              color="neutral"
              variant="outline"
              size="sm"
              class="font-mono"
            />
            <UBadge
              v-for="scope in tool.scopes"
              :key="scope"
              :label="scope"
              variant="subtle"
              size="sm"
              class="font-mono"
            />
          </div>
          <p class="mt-3 max-w-3xl text-muted" lang="en">{{ tool.description }}</p>
          <details class="mt-4 group">
            <summary class="cursor-pointer text-sm text-dimmed hover:text-highlighted">
              {{ m.tools.input }}
            </summary>
            <pre
              class="mt-3 overflow-x-auto rounded-lg border border-default bg-muted p-4 font-mono text-xs leading-relaxed text-highlighted"
              >{{ tool.input }}</pre>
          </details>
        </section>
      </article>
    </div>
  </UContainer>
</template>
