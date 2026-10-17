import { previewTokenFromCookie } from '@hollware/client'
import { defineNitroPlugin } from 'nitropack/runtime'
import { removeResponseHeader, setResponseHeader } from 'h3'
import { PREVIEW_HEADER } from '../tags.ts'

/**
 * A request that carries a preview token (the `hollware_preview` cookie, see `preview-exchange`)
 * reads the latest revision of an entry, and nothing may keep what it answers: the response is
 * `no-store` and has no cache tag, so neither the browser nor Workers Cache keeps it, and the
 * request gets a header of its own for Nitro's cache (`hollware.cache: <seconds>`) to vary on, so
 * it neither reads nor fills the entry that every other request of the path shares. Any request
 * without a token has no such header, whatever it sent.
 */

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('request', (event) => {
    const headers = event.node.req.headers
    if (previewTokenFromCookie(headers.cookie) === undefined) delete headers[PREVIEW_HEADER]
    else headers[PREVIEW_HEADER] = crypto.randomUUID()
  })
  nitroApp.hooks.hook('beforeResponse', (event) => {
    if (previewTokenFromCookie(event.node.req.headers.cookie) === undefined) return
    setResponseHeader(event, 'cache-control', 'no-store')
    for (const name of ['cache-tag', 'cloudflare-cdn-cache-control']) {
      removeResponseHeader(event, name)
    }
  })
})
