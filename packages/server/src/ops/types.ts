import type { OperationByName, OperationName, ResolvedSite } from '@hollware/core'
import type * as z from 'zod'
import type { Principal } from '../auth/types.ts'
import type {
  AnalyticsSources,
  Backups,
  Clock,
  ContentStore,
  Media,
  Semantic,
  Structure,
  View,
} from '../ports.ts'

/** What a handler gets besides its input. Adapters build it; handlers never see a request. */
export interface OperationContext {
  readonly site: ResolvedSite
  readonly principal: Principal
  /** `head` over MCP, `published` over RPC. */
  readonly view: View
  readonly store: ContentStore
  readonly clock: Clock
  /** What the client said about itself; writes record it as the actor's meta. */
  readonly client: Readonly<Record<string, unknown>> | null
  readonly requestId: string
  /**
   * Called with the ids of the events that a write committed to the outbox, so that they reach
   * the Queue now rather than at the next sweep of the cron trigger. Absent in tests.
   */
  readonly notify?: (eventIds: readonly string[]) => void
  /** The model and the vector index, when the Worker has both; absent or `null` without. */
  readonly semantic?: Semantic | null
  /**
   * The analytics connections of the sites, where an operation may read or change them;
   * absent or `null` over RPC.
   */
  readonly analytics?: AnalyticsSources | null
  /** The structure of the sites, where an operation may change it; absent over RPC. */
  readonly structure?: Structure
  /** The images of the site, when the Worker has their R2 bucket; absent or `null` without. */
  readonly media?: Media | null
  /**
   * A site reads: RPC and the read API, whatever the view, a preview of a draft included. A
   * reader sees the URL of each image where content wrote `asset:`; an agent over MCP sees what it
   * wrote.
   */
  readonly reader?: boolean
  /** Where the daily backups of the site are; absent or `null` when there is no bucket for them. */
  readonly backups?: Backups | null
}

/** The handler of one operation: its parsed input in, its output out. */
export type OperationHandler<Name extends OperationName> = (
  input: z.output<OperationByName<Name>['input']>,
  context: OperationContext,
) => Promise<z.output<OperationByName<Name>['output']>>

/** One handler for every operation. */
export type Handlers = { readonly [Name in OperationName]: OperationHandler<Name> }

export function defineHandlers(handlers: Handlers): Handlers {
  return handlers
}
