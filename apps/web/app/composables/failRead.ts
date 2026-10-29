import type { NuxtError } from 'nuxt/app'

export function failRead(error: NuxtError, path: string, notFound: string): never {
  if (error.statusCode !== 404 && import.meta.client) reloadNuxtApp({ path })
  throw createError({
    statusCode: error.statusCode,
    statusMessage: error.statusCode === 404 ? notFound : error.statusMessage,
    fatal: true,
  })
}
