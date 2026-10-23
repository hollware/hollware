import { previewTokenFromCookie } from '@hollware/client'
import { defineNitroPlugin } from 'nitropack/runtime'
import { edgeHeaders, tagsOf } from '../tags.ts'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('beforeResponse', (event) => {
    if (previewTokenFromCookie(event.node.req.headers.cookie) !== undefined) return
    const headers = edgeHeaders(tagsOf(event), event.node.res.statusCode, event.method)
    for (const [name, value] of Object.entries(headers ?? {})) event.node.res.setHeader(name, value)
  })
})
