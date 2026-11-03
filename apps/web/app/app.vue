<script setup lang="ts">
import { en as uiEn, es as uiEs } from '@nuxt/ui/locale'

const OG_IMAGE = 'https://hollware.com/og.png'
const route = useRoute()
const { locale, m } = useLocale()

useSeoMeta({
  titleTemplate: (title) => (title ? `${title} · Hollware` : m.value.seo.home),
  ogSiteName: 'Hollware',
  ogLocale: () => (locale.value === 'es' ? 'es' : 'en'),
  ogType: 'website',
  ogImage: OG_IMAGE,
  ogImageWidth: 1200,
  ogImageHeight: 630,
  ogImageAlt: () => m.value.seo.home,
  twitterCard: 'summary_large_image',
  twitterImage: OG_IMAGE,
})
useHead({
  htmlAttrs: { lang: locale },
  script: [
    {
      key: 'jsonld-site',
      type: 'application/ld+json',
      innerHTML: jsonLdOf([organization(), website('en')]),
    },
  ],
  link: () => {
    if (ownsHead(route.path)) return []
    const path = basePath(route.path)
    return [
      { rel: 'canonical', href: `https://hollware.com${route.path}` },
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
