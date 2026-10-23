import { previewTokenFromCookie } from '@hollware/client'
import { defineNitroPlugin } from 'nitropack/runtime'
import { removeResponseHeader, setResponseHeader } from 'h3'
import { PREVIEW_HEADER } from '../tags.ts'

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
