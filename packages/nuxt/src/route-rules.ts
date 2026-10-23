import type { NitroRouteConfig } from 'nitropack'
import { PREVIEW_HEADER } from './runtime/tags.ts'

export function secondsCacheRules(seconds: number): Record<string, NitroRouteConfig> {
  return {
    '/**': { cache: { swr: true, maxAge: seconds, varies: [PREVIEW_HEADER] } },
    '/_hollware/**': { swr: false, cache: false },
  }
}
