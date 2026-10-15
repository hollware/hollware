import { defineNuxtPlugin, useHead } from 'nuxt/app'

// Every page says what made it: the showcase of Hollware finds sites by this.
export default defineNuxtPlugin(() => {
  useHead({ meta: [{ name: 'generator', content: 'Hollware' }] })
})
