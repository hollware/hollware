import type { NuxtPage } from 'nuxt/schema'

function named(page: NuxtPage): NuxtPage {
  return {
    ...page,
    ...(page.name === undefined ? {} : { name: `es-${page.name}` }),
    ...(page.children === undefined ? {} : { children: page.children.map(named) }),
  }
}

function inSpanish(pages: NuxtPage[]): NuxtPage[] {
  return pages.map((page) => ({
    ...named(page),
    path: page.path === '/' ? '/es' : `/es${page.path}`,
  }))
}

export default defineNuxtConfig({
  compatibilityDate: '2026-10-06',
  buildDir: '.nuxt',
  modules: ['@nuxt/ui', '@hollware/nuxt'],
  css: ['~/assets/css/main.css'],
  hollware: { site: 'docs', cache: 'purge' },
  ui: { colorMode: false },
  icon: { serverBundle: { collections: ['lucide'] }, clientBundle: { scan: true } },
  hooks: {
    'pages:extend'(pages) {
      pages.push(...inSpanish(pages))
    },
  },
  app: {
    head: {
      htmlAttrs: { class: 'dark' },
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    },
  },
  nitro: {
    preset: 'cloudflare_module',
    cloudflare: { deployConfig: true, nodeCompat: false },
  },
  telemetry: false,
})
