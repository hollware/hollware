import type { AnalyticsSources } from '../ports.ts'
import type { HollwareEnv } from '../index.ts'
import { createAnalyticsSources } from './sources.ts'

/**
 * The analytics connections of the sites over the Worker's D1 (ADR-040): sealed with
 * HOLLWARE_SECRET, asked with the Worker's `fetch`, kept in its cache when it has one.
 */
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
