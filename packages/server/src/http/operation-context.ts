import type { ResolvedSite } from '@hollware/core'
import { analyticsSourcesOf } from '../analytics/env.ts'
import { backupsOf } from '../backup/run.ts'
import { connect } from '../db/d1.ts'
import { createD1Store } from '../db/index.ts'
import { enqueue } from '../events/run.ts'
import type { HollwareEnv } from '../index.ts'
import type { McpCall } from '../mcp/types.ts'
import { mediaOfEnv } from '../media/cloudflare.ts'
import type { Clock, Structure } from '../ports.ts'
import { semanticOfEnv } from '../semantic/cloudflare.ts'
import { newWebhookSecret, seal } from '../structure/seal.ts'
import { createSecretStore, createStructureStore } from '../structure/store.ts'
import type { EnqueueFailedLog } from './types.ts'

export interface OperationContextDeps {
  readonly clock: Clock
  readonly log: (entry: EnqueueFailedLog) => void
  readonly refresh?: (db: D1Database, options?: { readonly force?: boolean }) => Promise<void>
}

export type SharedContext = McpCall['context']

export function structureOf(
  deps: OperationContextDeps,
  db: D1Database,
  master?: string,
): Structure {
  return {
    store: createStructureStore(db, () => deps.clock.now()),
    changed: async () => {
      await deps.refresh?.(db, { force: true })
    },
    secrets: {
      make: async (site, name) => {
        if (master === undefined) return null
        const secret = newWebhookSecret()
        const sealed = await seal(master, secret, { site, name })
        await createSecretStore(db, () => deps.clock.now()).write(site, name, sealed)
        return secret
      },
    },
  }
}

export function operationContext(
  deps: OperationContextDeps,
  env: HollwareEnv,
  executionCtx: Pick<ExecutionContext, 'waitUntil'>,
  site: ResolvedSite,
  requestId: string,
): SharedContext {
  const { clock, log } = deps
  return {
    site,
    store: createD1Store(env.DB, { clock }),
    clock,
    notify: (ids) => {
      executionCtx.waitUntil(
        enqueue({ queue: env.EVENTS, db: connect(env.DB), site: site.key, ids, clock }).catch(
          (error: unknown) => {
            log({ kind: 'enqueue_failed', requestId, message: String(error) })
          },
        ),
      )
    },
    semantic: semanticOfEnv(env),
    analytics: analyticsSourcesOf(env, () => clock.now()),
    structure: structureOf(deps, env.DB, env.HOLLWARE_SECRET),
    media: mediaOfEnv(env),
    backups: backupsOf(env),
  }
}
