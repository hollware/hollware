<script setup lang="ts">
import { en as uiEn, es as uiEs } from '@nuxt/ui/locale'

const route = useRoute()
const { locale, m } = useLocale()

useSeoMeta({
  titleTemplate: (title) => (title ? `${title} · Hollware` : m.value.seo.home),
  ogSiteName: 'Hollware',
  ogLocale: () => (locale.value === 'es' ? 'es' : 'en'),
  twitterCard: 'summary_large_image',
})
// The page in each language, for readers and search engines; English is the default.
useHead({
  htmlAttrs: { lang: locale },
  link: () => {
    const path = basePath(route.path)
    return [
      { rel: 'alternate', hreflang: 'en', href: `https://hollware.com${path}` },
      { rel: 'alternate', hreflang: 'es', href: `https://hollware.com${pathIn('es', path)}` },
      { rel: 'alternate', hreflang: 'x-default', href: `https://hollware.com${path}` },
    ]
  },
})
</script>

<template>
  <UApp :locale="locale === 'es' ? uiEs : uiEn">
    <AppHeader />
    <UMain>
      <NuxtPage />
    </UMain>
    <AppFooter />
  </UApp>
</template>
