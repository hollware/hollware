<script setup lang="ts">
import { en as uiEn, es as uiEs } from '@nuxt/ui/locale'

const OG_IMAGE = 'https://hollware.com/og.png'
const route = useRoute()
const { locale, m } = useLocale()

useSeoMeta({
  titleTemplate: (title) => (title ? `${title} · Hollware` : m.value.seo.home),
  ogSiteName: 'Hollware',
  ogLocale: () => (locale.value === 'es' ? 'es_ES' : 'en_US'),
  ogLocaleAlternate: () => [locale.value === 'es' ? 'en_US' : 'es_ES'],
  ogUrl: () => (ownsHead(route.path) ? undefined : `${ORIGIN}${route.path}`),
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
      innerHTML: jsonLdOf([organization(), website()]),
    },
  ],
  link: () => {
    if (ownsHead(route.path)) return []
    const path = basePath(route.path)
    return linksOf({ path: route.path, alternates: { en: path, es: pathIn('es', path) } }).map(
      (link) => ({ ...link }),
    )
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
