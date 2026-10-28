<script setup lang="ts">
const kinds = eventKinds()

const { locale, m } = useLocale()
const pages = await useDocsPages(locale.value)

useSeoMeta({
  title: () => m.value.events.title,
  description: () => m.value.events.description,
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
          {{ m.events.title }}
        </h1>
        <p class="mt-3 max-w-2xl text-lg text-muted">{{ m.events.intro }}</p>
        <p v-if="m.events.untranslated" class="mt-2 max-w-2xl text-sm text-dimmed">
          {{ m.events.untranslated }}
        </p>
        <USeparator class="my-8" />
        <section class="space-y-3">
          <h2 class="text-xl font-semibold text-highlighted">{{ m.events.delivery }}</h2>
          <p class="max-w-3xl text-muted">{{ m.events.deliveryBody }}</p>
          <ul class="space-y-2 text-sm">
            <li>
              <code class="font-mono text-highlighted">{{ WEBHOOK_HEADERS.event }}</code>
              <span class="text-muted">: {{ m.events.eventHeader }}</span>
            </li>
            <li>
              <code class="font-mono text-highlighted">{{ WEBHOOK_HEADERS.timestamp }}</code>
              <span class="text-muted">: {{ m.events.timestampHeader }}</span>
            </li>
            <li>
              <code class="font-mono text-highlighted">{{ WEBHOOK_HEADERS.signature }}</code>
              <span class="text-muted">: {{ m.events.signatureHeader }}</span>
            </li>
          </ul>
        </section>
        <section
          v-for="kind in kinds"
          :id="kind.kinds[0]"
          :key="kind.kinds.join()"
          class="scroll-mt-24 py-8"
        >
          <h2 class="font-mono text-lg text-highlighted">{{ kind.kinds.join(' · ') }}</h2>
          <table class="mt-4 w-full text-left text-sm">
            <thead class="text-muted">
              <tr>
                <th class="py-1 pe-4 font-medium">{{ m.events.field }}</th>
                <th class="py-1 pe-4 font-medium">{{ m.events.type }}</th>
                <th class="py-1 font-medium">{{ m.events.about }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="field in kind.fields"
                :key="field.name"
                class="border-t border-default align-top"
              >
                <td class="py-2 pe-4 font-mono text-highlighted">{{ field.name }}</td>
                <td class="py-2 pe-4 font-mono text-muted">{{ field.type }}</td>
                <td class="py-2 text-muted" lang="en">{{ field.description }}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </article>
    </div>
  </UContainer>
</template>
