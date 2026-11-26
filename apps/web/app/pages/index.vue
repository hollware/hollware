<script setup lang="ts">
const page = await usePage('home', '')

usePageHead('home', page, (entry) => [
  softwareApplication({
    description:
      typeof entry.frontmatter['description'] === 'string' ? entry.frontmatter['description'] : '',
    version: FACTS.version,
    locale: entry.locale,
  }),
  faqPage(faqOf(entry.document)),
])
</script>

<template>
  <div class="landing">
    <PageBody :entry="page.entry.value" />
    <ClientOnly><LazyEmbersStage /></ClientOnly>
  </div>
</template>
