import { verifyWebhook } from '@hollware/core'
import { createError, defineEventHandler, getRequestHeaders, readRawBody } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'

/**
 * `POST /_hollware/webhook` (S8): an event of Hollware, signed with the secret of the webhook
 * (`NUXT_HOLLWARE_WEBHOOK_SECRET`), purges from Workers Cache the pages that showed what changed,
 * by the tags the event carries. A request whose signature does not hold is refused, and purges
 * nothing.
 */

interface WorkerCache {
  purge(options: { readonly tags: readonly string[] }): Promise<unknown>
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
    typeof Reflect.get(cache, 'purge') === 'function'
    ? {
        purge: (options) => Reflect.apply(Reflect.get(cache, 'purge'), cache, [options]),
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
        'This Worker has no cache to purge: set "cache": { "enabled": true } in wrangler.jsonc',
    })
  }
  if (tags.length > 0) await cache.purge({ tags })
  return { purged: tags }
})
