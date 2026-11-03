<script setup lang="ts">
import type { PageEntry } from '@hollware/nuxt'

defineProps<{ entry: PageEntry | null }>()

const components = {
  hero: resolveComponent('PageHero'),
  section: resolveComponent('PageSection'),
  'agent-session': resolveComponent('PageSession'),
  'install-prompt': resolveComponent('PageInstallPrompt'),
  facts: resolveComponent('PageFacts'),
  fact: resolveComponent('PageFact'),
  problems: resolveComponent('PageProblems'),
  problem: resolveComponent('PageProblem'),
  'chaos-order': resolveComponent('PageChaosOrder'),
  steps: resolveComponent('PageSteps'),
  step: resolveComponent('PageStep'),
  stack: resolveComponent('PageStack'),
  cards: resolveComponent('PageCards'),
  card: resolveComponent('PageCard'),
  faq: resolveComponent('PageFaq'),
  cta: resolveComponent('PageCta'),
  callout: resolveComponent('DocsCallout'),
  'brand-assets': resolveComponent('PageBrandAssets'),
  'copy-block': resolveComponent('PageCopyBlock'),
}
</script>

<template>
  <HollwareContent :entry="entry" :components="components" />
</template>
