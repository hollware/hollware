// hollware.com: the landing page and the documentation, which is written in Hollware (site `docs`)
// and read over a service binding with @hollware/nuxt.
export default defineNuxtConfig({
  compatibilityDate: '2026-10-06',
  // One build directory for prepare, dev and build: a build elsewhere rewrites the types of the
  // server routes to point there, and the type check of the repository loses them.
  buildDir: '.nuxt',
  modules: ['@nuxt/ui', '@hollware/nuxt'],
  css: ['~/assets/css/main.css'],
  // HOLLWARE_BEACON, at build time, is the Hollware that counts the views of the docs (ADR-031).
  // A page is kept 30 seconds: an approved page shows within that, and most requests render nothing.
  hollware: { site: 'docs', beacon: process.env['HOLLWARE_BEACON'] ?? '', cache: 30 },
  // Dark only: the page carries the class, and nothing switches it.
  ui: { colorMode: false },
  // Icons come from the installed collection, never fetched from a CDN at runtime.
  icon: { serverBundle: { collections: ['lucide'] }, clientBundle: { scan: true } },
  app: {
    head: {
      htmlAttrs: { lang: 'en', class: 'dark' },
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    },
  },
  nitro: {
    preset: 'cloudflare_module',
    cloudflare: { deployConfig: true, nodeCompat: false },
  },
  telemetry: false,
})
