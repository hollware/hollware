// A blog that reads the playground's Hollware, as a site of your own would read yours.
export default defineNuxtConfig({
  compatibilityDate: '2026-10-06',
  modules: ['@hollware/nuxt'],
  // The key of the site in the Hollware config. On Cloudflare the Worker reads it over the
  // service binding HOLLWARE of wrangler.jsonc; elsewhere set hollware.url and NUXT_HOLLWARE_TOKEN.
  // HOLLWARE_BEACON, at build time, is the public URL of the Hollware that counts page views.
  // A page is kept 30 seconds: a publish shows within that, and most requests render nothing.
  hollware: { site: 'playground', beacon: process.env['HOLLWARE_BEACON'] ?? '', cache: 30 },
  nitro: {
    preset: 'cloudflare_module',
    // The Worker is built with the config of wrangler.jsonc, without Node.js compatibility.
    cloudflare: { deployConfig: true, nodeCompat: false },
  },
  telemetry: false,
})
