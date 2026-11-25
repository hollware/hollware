import { previewTokenFromCookie } from '@hollware/client'
import type { ServerResponse } from 'node:http'
import { defineNitroPlugin, useRuntimeConfig } from 'nitropack/runtime'
import { removeResponseHeader, setResponseHeader, type H3Event } from 'h3'
import { embedFrameAncestors, embedPreviewRequest, markPreviewRequest } from '../tags.ts'
import { requestUrl } from './url.ts'

const UNCACHED = ['cache-tag', 'cloudflare-cdn-cache-control']

function hollwareUrl(event: H3Event): string {
  const config: unknown = useRuntimeConfig(event)['hollware']
  const url = typeof config === 'object' && config !== null ? Reflect.get(config, 'url') : ''
  return typeof url === 'string' ? url : ''
}

function withAncestors(policy: unknown, ancestors: string): string[] {
  const policies = (Array.isArray(policy) ? policy : [policy])
    .filter((value) => value !== undefined)
    .map(String)
  return policies.includes(ancestors) ? policies : [...policies, ancestors]
}

function holdEmbeddedHeaders(response: ServerResponse, ancestors: string | null) {
  function settle() {
    if (response.headersSent) return
    response.removeHeader('x-frame-options')
    for (const name of UNCACHED) response.removeHeader(name)
    response.setHeader('cache-control', 'no-store')
    response.setHeader('referrer-policy', 'no-referrer')
    if (ancestors !== null) {
      response.setHeader(
        'content-security-policy',
        withAncestors(response.getHeader('content-security-policy'), ancestors),
      )
    }
  }
  const writeHead = response.writeHead.bind(response) as (...args: unknown[]) => ServerResponse
  const end = response.end.bind(response) as (...args: unknown[]) => ServerResponse
  response.writeHead = ((...args: unknown[]) => {
    settle()
    return writeHead(...args)
  }) as ServerResponse['writeHead']
  response.end = ((...args: unknown[]) => {
    settle()
    return end(...args)
  }) as ServerResponse['end']
}

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('request', (event) => {
    if (embedPreviewRequest(event.node.req.headers, requestUrl(event))) {
      holdEmbeddedHeaders(event.node.res, embedFrameAncestors(hollwareUrl(event)))
    }
    markPreviewRequest(event.node.req.headers)
  })
  nitroApp.hooks.hook('beforeResponse', (event) => {
    if (previewTokenFromCookie(event.node.req.headers.cookie) === undefined) return
    setResponseHeader(event, 'cache-control', 'no-store')
    for (const name of UNCACHED) removeResponseHeader(event, name)
  })
})
