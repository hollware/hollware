import { verifyWebhook } from '@hollware/core'
import { createError, defineEventHandler, getRequestHeaders, readRawBody } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'

interface WorkerCache {
  invalidate(options: { readonly tags: readonly string[] }): Promise<unknown>
}

function cacheOf(context: unknown): WorkerCache | undefined {
  const cloudflare: unknown =
    typeof context === 'object' && context !== null ? Reflect.get(context, 'cloudflare') : undefined
  const ctx: unknown =
    typeof cloudflare === 'object' && cloudflare !== null
      ? Reflect.get(cloudflare, 'context')
      : undefined
  const cache: unknown =
    typeof ctx === 'object' && ctx !== null ? Reflect.get(ctx, 'cache') : undefined
  return typeof cache === 'object' &&
    cache !== null &&
    typeof Reflect.get(cache, 'invalidate') === 'function'
    ? {
        invalidate: (options) => Reflect.apply(Reflect.get(cache, 'invalidate'), cache, [options]),
      }
    : undefined
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const secret = String(Reflect.get(Reflect.get(config, 'hollware') ?? {}, 'webhookSecret') ?? '')
  const body = (await readRawBody(event, 'utf8')) ?? ''
  const headers = new Headers(
    Object.entries(getRequestHeaders(event)).flatMap(([name, value]) =>
      value === undefined ? [] : [[name, value]],
    ),
  )
  const now = Math.floor(Date.now() / 1000)
  if (secret === '' || !(await verifyWebhook({ secret, body, headers, now }))) {
    throw createError({
      statusCode: 401,
      statusMessage: 'The signature of the event does not hold',
    })
  }
  const payload: unknown = JSON.parse(body)
  const site = String(Reflect.get(Reflect.get(config, 'hollware') ?? {}, 'site') ?? '')
  const eventSite: unknown =
    typeof payload === 'object' && payload !== null ? Reflect.get(payload, 'site') : undefined
  if (eventSite !== site) {
    throw createError({ statusCode: 401, statusMessage: 'The event is of another site' })
  }
  const found: unknown =
    typeof payload === 'object' && payload !== null ? Reflect.get(payload, 'cacheTags') : undefined
  const tags = Array.isArray(found)
    ? found.filter((tag): tag is string => typeof tag === 'string')
    : []
  const cache = cacheOf(event.context)
  if (cache === undefined) {
    throw createError({
      statusCode: 501,
      statusMessage:
        'This Worker has no cache to invalidate: set "cache": { "enabled": true } in wrangler.jsonc',
    })
  }
  if (tags.length > 0) await cache.invalidate({ tags })
  return { invalidated: tags }
})
