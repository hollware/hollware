<script setup lang="ts">
import { OPERATIONS } from '@hollware/core'
import * as z from 'zod'

/**
 * The MCP tools, generated from the operation specs of @hollware/core at build time: the same
 * names, descriptions, scopes and input schemas that tools/list answers, so this page never drifts
 * from the server.
 */
const tools = OPERATIONS.map((operation) => ({
  name: operation.name,
  title: operation.title,
  description: operation.description,
  scopes: [...operation.scopes],
  effect: operation.effect,
  input: JSON.stringify(z.toJSONSchema(operation.input, { io: 'input' }), null, 2),
})).sort((a, b) => a.name.localeCompare(b.name))

const pages = await useDocsPages()

useSeoMeta({
  title: 'MCP tools',
  description:
    'Every tool of the Hollware MCP server: what it does, the scopes it needs and its input.',
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
        <p class="font-mono text-xs text-primary">Reference</p>
        <h1 class="mt-2 text-4xl font-semibold tracking-tight text-highlighted">MCP tools</h1>
        <p class="mt-3 max-w-2xl text-lg text-muted">
          The {{ tools.length }} tools of <code class="font-mono">/mcp</code>, as
          <code class="font-mono">tools/list</code> describes them. A tool checks its scopes when it
          runs: a token without them gets a 403 that names what is missing.
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
          <p class="mt-3 max-w-3xl text-muted">{{ tool.description }}</p>
          <details class="mt-4 group">
            <summary class="cursor-pointer text-sm text-dimmed hover:text-highlighted">
              Input schema
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
