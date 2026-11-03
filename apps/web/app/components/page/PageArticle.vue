<script setup lang="ts">
import type { PageEntry } from '@hollware/nuxt'

const props = defineProps<{
  entry: PageEntry | null
  untranslated: boolean
  crumbs: readonly { name: string; to: string }[]
}>()
const { locale, m } = useLocale()
const front = computed(() => props.entry?.frontmatter ?? {})
const text = (value: unknown) => (typeof value === 'string' ? value : '')
const sources = computed(() =>
  Array.isArray(front.value['sources'])
    ? front.value['sources'].filter((source): source is string => typeof source === 'string')
    : [],
)
const reviewed = computed(() => text(front.value['reviewed']))
const markdown = computed(() =>
  props.entry === null
    ? ''
    : markdownPathOf(props.entry.collection, props.entry.slug, props.entry.locale),
)
</script>

<template>
  <article v-if="entry" class="relative isolate" :lang="entry.locale">
    <div class="pointer-events-none absolute inset-x-0 top-0 -z-10 h-96 backdrop-glow" />
    <UContainer class="py-14 lg:py-20">
      <nav class="flex flex-wrap items-center gap-2 font-mono text-xs text-dimmed">
        <template v-for="(crumb, index) in crumbs" :key="crumb.to">
          <span v-if="index > 0">/</span>
          <NuxtLink :to="crumb.to" class="hover:text-highlighted">{{ crumb.name }}</NuxtLink>
        </template>
      </nav>
      <h1
        class="mt-6 max-w-3xl text-4xl font-semibold tracking-[-0.03em] text-balance text-highlighted sm:text-5xl"
      >
        {{ text(front['title']) }}
      </h1>
      <p class="mt-5 max-w-2xl text-lg leading-relaxed text-pretty text-muted">
        {{ text(front['description']) }}
      </p>
      <div class="mt-6 flex flex-wrap items-center gap-3">
        <UButton
          :to="markdown"
          :label="m.pages.markdown"
          icon="i-lucide-file-text"
          size="xs"
          color="neutral"
          variant="outline"
          external
        />
        <span v-if="reviewed" class="font-mono text-xs text-dimmed">
          {{ m.pages.reviewed(formatDay(reviewed, locale)) }}
        </span>
      </div>
      <UAlert
        v-if="untranslated && m.pages.untranslated"
        :title="m.pages.untranslated"
        icon="i-lucide-languages"
        color="neutral"
        variant="subtle"
        class="mt-6 max-w-3xl"
      />
      <USeparator class="my-10" />
      <div class="prose landing-article">
        <PageBody :entry="entry" />
      </div>
      <section v-if="sources.length > 0" class="mt-14 max-w-3xl border-t border-default pt-6">
        <h2 class="text-sm font-medium text-highlighted">{{ m.pages.sources }}</h2>
        <ul class="mt-3 space-y-1 text-sm">
          <li v-for="source in sources" :key="source">
            <a :href="source" class="break-all text-muted hover:text-highlighted" rel="noopener">{{
              source
            }}</a>
          </li>
        </ul>
      </section>
    </UContainer>
  </article>
</template>
