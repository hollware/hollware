import type { AnalyticsSettings } from '@hollware/core'
import type { PageCount } from '../ports.ts'
import type { Fetch } from './request.ts'

export interface Source {
  discover(): Promise<AnalyticsSettings>
  topPages(days: number, limit: number): Promise<PageCount[]>
}

export interface SourceInput {
  readonly fetch: Fetch
  readonly credential: string
  readonly settings: AnalyticsSettings
  readonly hosts: readonly string[]
  readonly now: () => Date
}

export function rowsFor(limit: number): number {
  return Math.min(limit * 3, 200)
}
