<script setup lang="ts">
const page = await usePage('pages', 'home', { home: true })

usePageHead('pages', page, (entry) => [
  softwareApplication({
    description:
      typeof entry.frontmatter['description'] === 'string' ? entry.frontmatter['description'] : '',
    version: FACTS.version,
    locale: entry.locale,
  }),
  faqPage(faqOf(entry.document)),
])
useSeoMeta({ robots: 'noindex, follow' })
</script>

<template>
  <div class="landing">
    <PageBody :entry="page.entry.value" />
  </div>
</template>
