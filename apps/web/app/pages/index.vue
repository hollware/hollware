<script setup lang="ts">
useSeoMeta({
  title: '',
  description:
    'Hollware is an open-source headless CMS on Cloudflare Workers. Agents write Markdown over MCP, contracts check every write, and your sites read it over Workers RPC.',
})

const features = [
  {
    icon: 'i-lucide-shield-check',
    title: 'Contracts on every write',
    description:
      'The schema of your frontmatter, your components and your rules check each draft. A draft that breaks one is saved anyway, with the fix an agent can apply.',
  },
  {
    icon: 'i-lucide-plug',
    title: 'MCP, natively',
    description:
      'Twelve tools over both revisions of the protocol, with personal tokens or OAuth. Claude Code, claude.ai and any MCP client write to it.',
  },
  {
    icon: 'i-lucide-database',
    title: 'One source of truth',
    description:
      'D1 keeps every entry and every revision, append only. Markdown goes in and comes back out byte for byte, never locked in a format of ours.',
  },
  {
    icon: 'i-lucide-zap',
    title: 'Read at the edge',
    description:
      'A Worker reads published content over a service binding: no network, no token. Anywhere else, the read API and a read token.',
  },
  {
    icon: 'i-lucide-users',
    title: 'People stay in the loop',
    description:
      'Passkeys, roles per site and a review queue: an author’s agent asks to publish, and an editor approves the diff in the admin.',
  },
  {
    icon: 'i-lucide-server',
    title: 'Yours to run',
    description:
      'It deploys to your own Cloudflare account in one command, built for the limits of the free plan. MIT licensed, no service in between.',
  },
]

const steps = [
  {
    title: 'Create a project',
    code: 'npm create hollware my-cms',
    description: 'A config, a Worker and a local database, with your site, its owner and a token.',
  },
  {
    title: 'Connect your agent',
    code: 'claude mcp add --transport http hollware http://localhost:5199/mcp --header "Authorization: Bearer hw_pat_…"',
    description: 'It reads your contracts with describe_site, then writes and publishes drafts.',
  },
  {
    title: 'Deploy it',
    code: 'npm run deploy',
    description:
      'Hollware creates its database, namespace and queues on your account, and migrates.',
  },
]

const config = `export default defineConfig({
  sites: {
    blog: {
      locales: ['en', 'es'],
      defaultLocale: 'en',
      collections: {
        posts: defineCollection({
          schema: z.object({
            title: z.string().min(1),
            description: z.string().max(160),
            date: z.iso.date(),
          }),
          routes: { en: '/blog/:slug/', es: '/es/blog/:slug/' },
          contracts: [contracts.imagesHaveAlt()],
        }),
      },
    },
  },
})`
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
        <UBadge
          label="v0.4 · open source · Cloudflare Workers"
          color="neutral"
          variant="outline"
          class="rounded-full font-mono"
        />
      </template>
      <template #title>The CMS your agents write&nbsp;to</template>
      <template #description>
        Hollware is a headless CMS native to Cloudflare Workers. Agents write Markdown over MCP,
        contracts check every write, D1 keeps the content, and your sites read it over Workers RPC.
      </template>
      <template #links>
        <div class="flex flex-col items-start gap-4">
          <CopyCommand command="npm create hollware my-cms" />
          <div class="flex flex-wrap gap-3">
            <UButton to="/docs/" size="lg" trailing-icon="i-lucide-arrow-right">
              Read the docs
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
      headline="Why Hollware"
      title="Content that agents can write, and that you can trust"
      description="Every write goes through the same checks, whoever makes it: an agent, a person in the admin, or a script."
      :features="features"
      :ui="{ title: 'text-gradient tracking-tight', features: 'gap-y-10' }"
    />

    <UPageSection
      headline="Three commands"
      title="From nothing to live"
      :ui="{ title: 'text-gradient tracking-tight' }"
    >
      <ol class="grid gap-4 lg:grid-cols-3">
        <li
          v-for="(step, index) in steps"
          :key="step.title"
          class="flex flex-col gap-3 rounded-xl border border-default bg-muted/40 p-6"
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
      headline="hollware.config.ts"
      title="Your contracts are code"
      description="One file says what your content is: its schema, its routes per locale, its components and its rules. Agents read it before they write, and every write is checked against it."
      :links="[
        {
          label: 'How contracts work',
          to: '/docs/contracts/',
          trailingIcon: 'i-lucide-arrow-right',
          color: 'neutral',
          variant: 'link',
        },
      ]"
      :ui="{ title: 'text-gradient tracking-tight' }"
    >
      <pre
        class="overflow-x-auto rounded-xl border border-default bg-muted/80 p-5 font-mono text-[13px] leading-relaxed text-highlighted"
      ><code>{{ config }}</code></pre>
    </UPageSection>

    <UPageSection :ui="{ container: 'pb-28' }">
      <div
        class="relative overflow-hidden rounded-2xl border border-default bg-muted/50 px-6 py-16 text-center"
      >
        <div class="pointer-events-none absolute inset-0 backdrop-glow" />
        <h2 class="relative text-3xl font-semibold tracking-tight text-gradient sm:text-4xl">
          Give your agents a CMS
        </h2>
        <p class="relative mx-auto mt-4 max-w-xl text-muted">
          Running on your own Cloudflare account in a few minutes.
        </p>
        <div class="relative mt-8 flex justify-center">
          <CopyCommand command="npm create hollware my-cms" />
        </div>
      </div>
    </UPageSection>
  </div>
</template>
