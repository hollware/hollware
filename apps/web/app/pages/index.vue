<script setup lang="ts">
import { OPERATIONS } from '@hollware/core'

const { m, to } = useLocale()

useSeoMeta({
  title: '',
  description: () => m.value.seo.description,
})

const features = computed(() => {
  const words = m.value.home.features
  return [
    { icon: 'i-lucide-shield-check', ...words.contracts },
    {
      icon: 'i-lucide-plug',
      title: words.mcp.title,
      description: words.mcp.description(OPERATIONS.length),
    },
    { icon: 'i-lucide-database', ...words.truth },
    { icon: 'i-lucide-zap', ...words.edge },
    { icon: 'i-lucide-users', ...words.people },
    { icon: 'i-lucide-server', ...words.yours },
  ]
})

const steps = computed(() => {
  const words = m.value.home.steps
  return [
    { ...words.create, code: 'npm create hollware my-cms' },
    {
      ...words.connect,
      code: 'claude mcp add --transport http hollware http://localhost:5199/mcp --header "Authorization: Bearer hw_pat_…"',
    },
    { ...words.deploy, code: 'npm run deploy' },
  ]
})

// The code is the same in every language; its comments are the reader's.
const shaping = computed(() =>
  [
    m.value.home.shaping.comment,
    `set_collection({
  version: 4,
  name: 'posts',
  collection: {
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 1 },
        subtitle: { type: 'string', minLength: 1 },
      },
      required: ['title', 'subtitle'],
    },
    routes: { en: '/blog/:slug/', es: '/es/blog/:slug/' },
    rules: [{ rule: 'field-length', params: { field: 'title', max: 60 } }],
  },
})`,
    ...m.value.home.shaping.answer,
  ].join('\n'),
)
</script>

<template>
  <div class="relative">
    <div class="pointer-events-none absolute inset-x-0 top-0 h-[44rem] backdrop-grid" />
    <div class="pointer-events-none absolute inset-x-0 top-0 h-[44rem] backdrop-glow" />

    <UPageHero
      orientation="horizontal"
      :ui="{
        container: 'relative py-20 sm:py-28 lg:py-32',
        title: 'text-5xl sm:text-6xl lg:text-7xl',
      }"
    >
      <template #headline>
        <UBadge :label="m.home.badge" color="neutral" variant="outline" class="font-mono" />
      </template>
      <template #title>{{ m.home.title }}</template>
      <template #description>{{ m.home.description }}</template>
      <template #links>
        <div class="flex flex-col items-start gap-4">
          <CopyCommand command="npm create hollware my-cms" />
          <div class="flex flex-wrap gap-3">
            <UButton :to="to('/docs/')" size="lg" trailing-icon="i-lucide-arrow-right">
              {{ m.home.readDocs }}
            </UButton>
            <UButton
              to="https://github.com/hollware/hollware"
              target="_blank"
              size="lg"
              color="neutral"
              variant="outline"
              icon="i-lucide-github"
            >
              GitHub
            </UButton>
          </div>
        </div>
      </template>
      <AgentSession />
    </UPageHero>

    <UPageSection
      :headline="m.home.why.headline"
      :title="m.home.why.title"
      :description="m.home.why.description"
      :features="features"
      :ui="{ features: 'gap-y-10' }"
    />

    <UPageSection :headline="m.home.steps.headline" :title="m.home.steps.title">
      <ol class="grid gap-4 lg:grid-cols-3">
        <li
          v-for="(step, index) in steps"
          :key="step.title"
          class="flex flex-col gap-3 rounded-lg border border-default bg-muted/40 p-6"
        >
          <span class="font-mono text-xs text-primary">0{{ index + 1 }}</span>
          <h3 class="font-medium text-highlighted">{{ step.title }}</h3>
          <code
            class="overflow-x-auto rounded-md border border-default bg-default px-3 py-2 font-mono text-[13px] text-highlighted"
            >{{ step.code }}</code
          >
          <p class="text-sm text-muted">{{ step.description }}</p>
        </li>
      </ol>
    </UPageSection>

    <UPageSection
      orientation="horizontal"
      :headline="m.home.shaping.headline"
      :title="m.home.shaping.title"
      :description="m.home.shaping.description"
      :links="[
        {
          label: m.home.shaping.link,
          to: to('/docs/configure-your-content/'),
          trailingIcon: 'i-lucide-arrow-right',
          color: 'neutral',
          variant: 'link',
        },
      ]"
    >
      <pre
        class="overflow-x-auto rounded-lg border border-default bg-muted/80 p-5 font-mono text-[13px] leading-relaxed text-highlighted"
      ><code>{{ shaping }}</code></pre>
    </UPageSection>

    <UPageSection :ui="{ container: 'pb-28' }">
      <div
        class="relative overflow-hidden rounded-lg border border-default bg-muted/50 px-6 py-16 text-center"
      >
        <div class="pointer-events-none absolute inset-0 backdrop-glow" />
        <h2 class="relative text-3xl font-semibold text-highlighted sm:text-4xl">
          {{ m.home.cta.title }}
        </h2>
        <p class="relative mx-auto mt-4 max-w-xl text-muted">
          {{ m.home.cta.description }}
        </p>
        <div class="relative mt-8 flex justify-center">
          <CopyCommand command="npm create hollware my-cms" />
        </div>
      </div>
    </UPageSection>
  </div>
</template>
