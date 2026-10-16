import { defineNitroPlugin } from 'nitropack/runtime'
import { edgeHeaders, tagsOf } from '../tags.ts'

/**
 * The cache of `hollware.cache: 'purge'` (S8): a response that read Hollware and answered 200 is
 * kept by Cloudflare's Workers Cache, which serves it again without running the Worker, tagged with
 * what it showed, until an event of Hollware purges one of its tags (`/_hollware/webhook`). The
 * browser keeps nothing: only the edge does (`cloudflare-cdn-cache-control`).
 */

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('beforeResponse', (event) => {
    const headers = edgeHeaders(tagsOf(event), event.node.res.statusCode, event.method)
    for (const [name, value] of Object.entries(headers ?? {})) event.node.res.setHeader(name, value)
  })
})
