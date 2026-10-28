<script setup lang="ts">
const endpoints = readApiEndpoints()

const { locale, m } = useLocale()
const pages = await useDocsPages(locale.value)

useSeoMeta({
  title: () => m.value.readApi.title,
  description: () => m.value.readApi.description,
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
          {{ m.readApi.title }}
        </h1>
        <p class="mt-3 max-w-2xl text-lg text-muted">{{ m.readApi.intro(endpoints.length) }}</p>
        <p v-if="m.readApi.untranslated" class="mt-2 max-w-2xl text-sm text-dimmed">
          {{ m.readApi.untranslated }}
        </p>
        <USeparator class="my-8" />
        <section
          v-for="endpoint in endpoints"
          :id="endpoint.operation"
          :key="endpoint.operation"
          class="scroll-mt-24 py-8 first:pt-0"
        >
          <div class="flex flex-wrap items-center gap-3">
            <UBadge :label="endpoint.method" variant="subtle" size="sm" class="font-mono" />
            <h2 class="min-w-0 font-mono text-lg break-all text-highlighted">
              {{ endpoint.path }}
            </h2>
          </div>
          <p class="mt-3 max-w-3xl text-muted" lang="en">{{ endpoint.description }}</p>
          <p class="mt-2 text-sm text-dimmed">
            {{ m.readApi.answers }} <span lang="en">{{ endpoint.answers }}</span> ·
            {{ endpoint.statuses.join(', ') }}
          </p>
          <table v-if="endpoint.parameters.length > 0" class="mt-4 w-full text-left text-sm">
            <thead class="text-muted">
              <tr>
                <th class="py-1 pe-4 font-medium">{{ m.readApi.parameter }}</th>
                <th class="py-1 pe-4 font-medium">{{ m.readApi.in }}</th>
                <th class="py-1 font-medium">{{ m.readApi.about }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="parameter in endpoint.parameters"
                :key="parameter.name"
                class="border-t border-default align-top"
              >
                <td class="py-2 pe-4 font-mono text-highlighted">
                  {{ parameter.name
                  }}<span v-if="parameter.required" class="text-secondary">*</span>
                </td>
                <td class="py-2 pe-4 font-mono text-muted">{{ parameter.in }}</td>
                <td class="py-2 text-muted" lang="en">{{ parameter.description ?? '' }}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </article>
    </div>
  </UContainer>
</template>
