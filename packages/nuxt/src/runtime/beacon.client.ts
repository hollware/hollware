import { defineNuxtPlugin, useRouter, useRuntimeConfig } from 'nuxt/app'
import { sendView } from './beacon.ts'

// Counts each page the reader sees, the first one and every navigation after it.
export default defineNuxtPlugin((nuxtApp) => {
  const config: unknown = useRuntimeConfig().public['hollware']
  if (typeof config !== 'object' || config === null) return
  const site = 'site' in config && typeof config.site === 'string' ? config.site : ''
  const beacon = 'beacon' in config && typeof config.beacon === 'string' ? config.beacon : ''
  if (site === '' || beacon === '') return
  const router = useRouter()
  nuxtApp.hook('page:finish', () => {
    sendView((url, init) => fetch(url, init), beacon, site, router.currentRoute.value.path)
  })
})
