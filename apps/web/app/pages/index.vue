<script setup lang="ts">
import { OPERATIONS } from '@hollware/core'
import hollwarePackage from '@hollware/core/package.json'

const { m, to } = useLocale()

useSeoMeta({
  title: '',
  description: () => m.value.seo.description,
})

const flow = computed(() => {
  const icons = ['i-lucide-bot', 'i-lucide-shield-check', 'i-lucide-user-check', 'i-lucide-globe']
  return m.value.home.flow.steps.map((step, index) => ({
    ...step,
    icon: icons[index] ?? 'i-lucide-circle',
  }))
})

const benefits = computed(() => {
  const words = m.value.home.benefits.items
  return [
    { icon: 'i-lucide-shield-check', ...words.contracts },
    { icon: 'i-lucide-history', ...words.history },
    { icon: 'i-lucide-user-check', ...words.people },
    { icon: 'i-lucide-zap', ...words.live },
    { icon: 'i-lucide-file-text', ...words.yours },
    { icon: 'i-lucide-piggy-bank', ...words.free },
  ]
})

const different = computed(() => {
  const words = m.value.home.different.items
  return [
    { ...words.agents, description: words.agents.description(OPERATIONS.length) },
    words.rules,
    words.operate,
    words.reads,
  ]
})

// The names are Cloudflare's, the same in every language; what each one does is the reader's.
const products = computed(() => {
  const words = m.value.home.cloudflare.products
  return [
    { name: 'Workers', icon: 'i-lucide-cpu', role: words.workers, optional: false },
    { name: 'D1', icon: 'i-lucide-database', role: words.d1, optional: false },
    { name: 'R2', icon: 'i-lucide-archive', role: words.r2, optional: false },
    { name: 'Images', icon: 'i-lucide-image', role: words.images, optional: false },
    { name: 'Service bindings', icon: 'i-lucide-cable', role: words.rpc, optional: false },
    { name: 'Workers Cache', icon: 'i-lucide-gauge', role: words.cache, optional: false },
    { name: 'Queues', icon: 'i-lucide-send', role: words.queues, optional: false },
    { name: 'Cron Triggers', icon: 'i-lucide-clock', role: words.cron, optional: false },
    { name: 'KV', icon: 'i-lucide-key-round', role: words.kv, optional: false },
    {
      name: 'Static Assets',
      icon: 'i-lucide-layout-dashboard',
      role: words.assets,
      optional: false,
    },
    { name: 'Workers AI · Vectorize', icon: 'i-lucide-sparkles', role: words.ai, optional: true },
    {
      name: 'Analytics Engine',
      icon: 'i-lucide-chart-line',
      role: words.analytics,
      optional: true,
    },
  ]
})

// What runs where, left to right, and what joins each part to the next.
const diagram = computed(() => {
  const words = m.value.home.cloudflare.diagram
  return [
    {
      title: words.writers,
      icon: 'i-lucide-bot',
      chips: ['Claude Code', 'claude.ai', 'CLI'],
      via: words.writersVia,
      main: false,
    },
    {
      title: words.hollware,
      icon: 'i-lucide-cpu',
      chips: ['D1', 'R2', 'Images', 'Queues', 'KV'],
      via: words.siteVia,
      main: true,
    },
    {
      title: words.site,
      icon: 'i-lucide-app-window',
      chips: ['Nuxt', 'Astro', 'React', 'Vue'],
      via: words.readersVia,
      main: false,
    },
    {
      title: words.readers,
      icon: 'i-lucide-globe',
      chips: ['Workers Cache'],
      via: null,
      main: false,
    },
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
        title: 'text-5xl text-balance sm:text-6xl lg:text-7xl',
      }"
    >
      <template #headline>
        <UBadge
          :label="m.home.badge(hollwarePackage.version)"
          color="neutral"
          variant="outline"
          class="font-mono"
        />
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
              to="https://demo.hollware.com"
              target="_blank"
              size="lg"
              color="neutral"
              variant="outline"
              icon="i-lucide-globe"
            >
              {{ m.home.demo }}
            </UButton>
            <UButton
              to="https://github.com/hollware/hollware"
              target="_blank"
              size="lg"
              color="neutral"
              variant="ghost"
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
      id="how-it-works"
      :headline="m.home.flow.headline"
      :title="m.home.flow.title"
      :description="m.home.flow.description"
    >
      <ol class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <li
          v-for="(step, index) in flow"
          :key="step.title"
          class="relative flex flex-col gap-3 rounded-lg border border-default bg-muted/40 p-6"
        >
          <div class="flex items-center justify-between">
            <span
              class="flex size-9 items-center justify-center rounded-md border border-accented bg-default"
            >
              <UIcon :name="step.icon" class="size-4 text-secondary" />
            </span>
            <span class="font-mono text-xs text-dimmed">0{{ index + 1 }}</span>
          </div>
          <h3 class="font-medium text-highlighted">{{ step.title }}</h3>
          <p class="text-sm text-muted">{{ step.description }}</p>
          <code class="mt-auto self-start pt-2 font-mono text-xs text-secondary">{{
            step.detail
          }}</code>
          <UIcon
            v-if="index < flow.length - 1"
            name="i-lucide-chevron-right"
            class="absolute top-1/2 -right-[1.125rem] z-10 hidden size-5 -translate-y-1/2 text-dimmed lg:block"
          />
        </li>
      </ol>
    </UPageSection>

    <UPageSection
      :headline="m.home.benefits.headline"
      :title="m.home.benefits.title"
      :description="m.home.benefits.description"
      :features="benefits"
      :ui="{ features: 'gap-y-10' }"
    />

    <UPageSection
      id="use-cases"
      :headline="m.home.cases.headline"
      :title="m.home.cases.title"
      :description="m.home.cases.description"
    >
      <HomeUseCases />
    </UPageSection>

    <UPageSection
      :headline="m.home.different.headline"
      :title="m.home.different.title"
      :description="m.home.different.description"
    >
      <div
        class="grid gap-px overflow-hidden rounded-lg border border-default bg-(--ui-border) sm:grid-cols-2"
      >
        <div
          v-for="(item, index) in different"
          :key="item.title"
          class="flex flex-col gap-3 bg-default p-6 sm:p-8"
        >
          <span class="font-mono text-sm text-secondary">0{{ index + 1 }}</span>
          <h3 class="text-lg font-semibold text-balance text-highlighted">{{ item.title }}</h3>
          <p class="text-muted">{{ item.description }}</p>
        </div>
      </div>
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

    <div id="cloudflare" class="relative border-y border-default bg-muted/30">
      <div class="pointer-events-none absolute inset-x-0 top-0 h-80 backdrop-glow-cloudflare" />
      <UPageSection
        :ui="{ container: 'relative' }"
        :title="m.home.cloudflare.title"
        :description="m.home.cloudflare.description"
      >
        <template #headline>
          <span class="inline-flex items-center gap-2 text-cloudflare">
            <UIcon name="i-lucide-cloud" class="size-4" />
            {{ m.home.cloudflare.headline }}
          </span>
        </template>

        <div class="flex flex-col gap-2 lg:flex-row lg:items-stretch">
          <template v-for="node in diagram" :key="node.title">
            <div
              class="flex flex-1 flex-col gap-3 rounded-lg border bg-default p-4"
              :class="
                node.main ? 'border-secondary/60 shadow-lg shadow-emerald-500/10' : 'border-default'
              "
            >
              <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
                <UIcon
                  :name="node.icon"
                  class="size-4 shrink-0"
                  :class="node.main ? 'text-secondary' : 'text-muted'"
                />
                {{ node.title }}
              </div>
              <div class="flex flex-wrap gap-1.5">
                <UBadge
                  v-for="chip in node.chips"
                  :key="chip"
                  :label="chip"
                  color="neutral"
                  variant="subtle"
                  size="sm"
                  class="font-mono"
                />
              </div>
            </div>
            <div
              v-if="node.via !== null"
              class="flex items-center justify-center gap-2 font-mono text-[11px] text-dimmed lg:w-24 lg:flex-col lg:gap-1 lg:text-center"
            >
              <UIcon name="i-lucide-arrow-right" class="size-4 shrink-0 rotate-90 lg:rotate-0" />
              <span>{{ node.via }}</span>
            </div>
          </template>
        </div>

        <ul
          class="grid gap-px overflow-hidden rounded-lg border border-default bg-(--ui-border) sm:grid-cols-2 lg:grid-cols-4"
        >
          <li
            v-for="product in products"
            :key="product.name"
            class="flex flex-col gap-2 bg-default p-5"
          >
            <div class="flex items-center gap-2">
              <UIcon :name="product.icon" class="size-4 shrink-0 text-cloudflare" />
              <span class="font-medium text-highlighted">{{ product.name }}</span>
              <UBadge
                v-if="product.optional"
                :label="m.home.cloudflare.optional"
                color="neutral"
                variant="outline"
                size="sm"
                class="ml-auto"
              />
            </div>
            <p class="text-sm text-muted">{{ product.role }}</p>
          </li>
        </ul>
      </UPageSection>
    </div>

    <UPageSection :headline="m.home.steps.headline" :title="m.home.steps.title">
      <ol class="grid gap-4 lg:grid-cols-3">
        <li
          v-for="(step, index) in steps"
          :key="step.title"
          class="flex min-w-0 flex-col gap-3 rounded-lg border border-default bg-muted/40 p-6"
        >
          <span class="font-mono text-xs text-secondary">0{{ index + 1 }}</span>
          <h3 class="font-medium text-highlighted">{{ step.title }}</h3>
          <code
            class="overflow-x-auto rounded-md border border-default bg-default px-3 py-2 font-mono text-[13px] whitespace-nowrap text-highlighted"
            >{{ step.code }}</code
          >
          <p class="text-sm text-muted">{{ step.description }}</p>
        </li>
      </ol>
    </UPageSection>

    <UPageSection :ui="{ container: 'pb-28' }">
      <div
        class="relative overflow-hidden rounded-lg border border-default bg-muted/50 px-6 py-16 text-center"
      >
        <div class="pointer-events-none absolute inset-0 backdrop-glow" />
        <h2 class="relative text-3xl font-semibold text-balance text-highlighted sm:text-4xl">
          {{ m.home.cta.title }}
        </h2>
        <p class="relative mx-auto mt-4 max-w-xl text-muted">
          {{ m.home.cta.description }}
        </p>
        <div class="relative mt-8 flex flex-col items-center gap-4">
          <CopyCommand command="npm create hollware my-cms" />
          <UButton
            :to="to('/docs/')"
            color="neutral"
            variant="link"
            trailing-icon="i-lucide-arrow-right"
          >
            {{ m.home.readDocs }}
          </UButton>
        </div>
      </div>
    </UPageSection>
  </div>
</template>
