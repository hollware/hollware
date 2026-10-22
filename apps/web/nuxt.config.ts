// hollware.com: the landing page and the documentation, which is written in Hollware (site `docs`)
// and read over a service binding with @hollware/nuxt.
import type { NuxtPage } from 'nuxt/schema'

/** A page, and the pages within it, under names of their own in Spanish. */
function named(page: NuxtPage): NuxtPage {
  return {
    ...page,
    ...(page.name === undefined ? {} : { name: `es-${page.name}` }),
    ...(page.children === undefined ? {} : { children: page.children.map(named) }),
  }
}

/** Every page again under `/es/`, the same component: its words follow the path (useLocale). */
function inSpanish(pages: NuxtPage[]): NuxtPage[] {
  return pages.map((page) => ({
    ...named(page),
    path: page.path === '/' ? '/es' : `/es${page.path}`,
  }))
}

export default defineNuxtConfig({
  compatibilityDate: '2026-10-06',
  // One build directory for prepare, dev and build: a build elsewhere rewrites the types of the
  // server routes to point there, and the type check of the repository loses them.
  buildDir: '.nuxt',
  modules: ['@nuxt/ui', '@hollware/nuxt'],
  css: ['~/assets/css/main.css'],
  // Pages are kept in Workers Cache until Hollware's webhook purges what changed (S8): an approved
  // page shows in seconds, and most requests run nothing. NUXT_HOLLWARE_WEBHOOK_SECRET checks it.
  hollware: { site: 'docs', cache: 'purge' },
  // Dark only: the page carries the class, and nothing switches it.
  ui: { colorMode: false },
  // Icons come from the installed collection, never fetched from a CDN at runtime.
  icon: { serverBundle: { collections: ['lucide'] }, clientBundle: { scan: true } },
  hooks: {
    'pages:extend'(pages) {
      pages.push(...inSpanish(pages))
    },
  },
  app: {
    head: {
      // The language is the page's (app.vue), English or Spanish.
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
