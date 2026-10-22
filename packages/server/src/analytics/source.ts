import type { AnalyticsSettings } from '@hollware/core'
import type { PageCount } from '../ports.ts'
import type { Fetch } from './request.ts'

/** One provider of analytics, with the credential and the settings of a connection (ADR-040). */
export interface Source {
  /**
   * The settings with what the credential shows filled in (an account, a project, a region), or a
   * `ProviderError` that says what to give the credential.
   */
  discover(): Promise<AnalyticsSettings>
  /** The `limit` most read paths of the site's hosts in the last `days`, normalized. */
  topPages(days: number, limit: number): Promise<PageCount[]>
}

/** What a provider is built from. `settings` are the discovered ones once `discover` ran. */
export interface SourceInput {
  readonly fetch: Fetch
  readonly credential: string
  readonly settings: AnalyticsSettings
  /** The site's hosts, checked by `hostsOf`: safe to put in a query as they are. */
  readonly hosts: readonly string[]
  readonly now: () => Date
}

/** How many raw rows to ask for: normalizing merges some (`/a` and `/a/`) and drops others. */
export function rowsFor(limit: number): number {
  return Math.min(limit * 3, 200)
}
