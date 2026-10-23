import type { AnalyticsSources } from '../ports.ts'
import type { HollwareEnv } from '../index.ts'
import { createAnalyticsSources } from './sources.ts'

export function analyticsSourcesOf(
  env: Pick<HollwareEnv, 'DB' | 'HOLLWARE_SECRET'>,
  now: () => Date,
): AnalyticsSources {
  return createAnalyticsSources({
    db: env.DB,
    master: env.HOLLWARE_SECRET,
    fetch: (input, init) => fetch(input, init),
    cache: typeof caches === 'undefined' ? null : caches.default,
    now,
  })
}
