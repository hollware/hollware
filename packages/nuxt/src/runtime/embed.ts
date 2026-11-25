import { defineNuxtPlugin } from 'nuxt/app'
import { withoutPreviewToken } from './tags.ts'

export default defineNuxtPlugin({
  name: 'hollware:embedded-preview',
  enforce: 'post',
  setup(nuxtApp) {
    nuxtApp.hooks.hook('app:rendered', () => {
      const { path } = nuxtApp.payload
      if (typeof path === 'string') nuxtApp.payload.path = withoutPreviewToken(path)
    })
  },
})
