<script setup lang="ts">
useSeoMeta({
  titleTemplate: (title) =>
    title ? `${title} · Hollware` : 'Hollware: the CMS your agents write to',
  ogSiteName: 'Hollware',
  twitterCard: 'summary_large_image',
})
</script>

<template>
  <UApp>
    <AppHeader />
    <UMain>
      <NuxtPage />
    </UMain>
    <AppFooter />
  </UApp>
</template>
