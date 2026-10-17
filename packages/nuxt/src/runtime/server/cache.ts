import { previewTokenFromCookie } from '@hollware/client'
import { defineNitroPlugin } from 'nitropack/runtime'
import { edgeHeaders, tagsOf } from '../tags.ts'

/**
 * The cache of `hollware.cache: 'purge'` (S8): a response that read Hollware and answered 200 is
 * kept by Cloudflare's Workers Cache, which serves it again without running the Worker, tagged with
 * what it showed, until an event of Hollware purges one of its tags (`/_hollware/webhook`). The
 * browser keeps nothing: only the edge does (`cloudflare-cdn-cache-control`). A preview is never kept.
 */

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('beforeResponse', (event) => {
    // A request with a preview token read the latest revision of an entry: nothing keeps it.
    if (previewTokenFromCookie(event.node.req.headers.cookie) !== undefined) return
    const headers = edgeHeaders(tagsOf(event), event.node.res.statusCode, event.method)
    for (const [name, value] of Object.entries(headers ?? {})) event.node.res.setHeader(name, value)
  })
})
