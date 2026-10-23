export default defineNuxtConfig({
  compatibilityDate: '2026-10-06',
  modules: ['@hollware/nuxt'],
  hollware: { site: 'playground', cache: 'purge' },
  nitro: {
    preset: 'cloudflare_module',
    cloudflare: { deployConfig: true, nodeCompat: false },
  },
  telemetry: false,
})
