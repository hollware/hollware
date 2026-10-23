import { defineNuxtPlugin, useHead } from 'nuxt/app'

export default defineNuxtPlugin(() => {
  useHead({ meta: [{ name: 'generator', content: 'Hollware' }] })
})
