import {
  definitionsFromConfig,
  resolveConfig,
  type HollwareConfig,
  type ResolvedSite,
} from '@hollware/core'
import manifest from '../package.json' with { type: 'json' }
import { createGateway } from './http/index.ts'
import type { HollwareEnv, HollwareWorker } from './index.ts'
import { createMcpEndpoint } from './mcp/index.ts'
import type { Handlers } from './ops/types.ts'
import type { Clock } from './ports.ts'
import { connect } from './db/d1.ts'
import { createD1Store } from './db/index.ts'
import { dropExpired } from './identity/store.ts'
import type { DeliveryDeps } from './events/deliver.ts'
import { consumeEvents, sweepOutbox } from './events/run.ts'
import { createEntrypoint, createRpc } from './rpc/index.ts'
import { runDueSchedules } from './schedule/run.ts'
import { semanticOfEnv } from './semantic/cloudflare.ts'
import { healVectors, refreshRelated } from './semantic/index-entry.ts'
import { createSiteRegistry } from './structure/registry.ts'
import { unseal } from './structure/seal.ts'
import { createSecretStore } from './structure/store.ts'

export interface ComposeOptions {
  /**
   * The time of every request: a token's expiry, the hour of `last_used_at` and every write are
   * read from it, each time a request needs it and not once at startup. The system clock when
   * absent; tests fix it.
   */
  readonly clock?: Clock
}

const systemClock: Clock = { now: () => new Date() }

/** How often the cron trigger wakes the agents, when the Worker has the `AGENTS` binding. */
export const AGENTS_EVERY_MINUTES = 10

/** Whether the run of the cron at `time` wakes the agents: on the minutes that divide by ten. */
export function wakesAgents(time: number): boolean {
  return Math.floor(time / 60_000) % AGENTS_EVERY_MINUTES === 0
}

/** What the MCP endpoint calls the server, in `server/discover` and `initialize`. */
const SERVER_INFO = { name: 'hollware', title: 'Hollware', version: manifest.version }

/** One JSON line per entry, so that Workers Logs indexes its fields. */
function writeLog(entry: object): void {
  console.log(JSON.stringify(entry))
}

/**
 * Builds the Worker from the config and the handlers of the operations (WP9). `createHollware`
 * is this with the real handlers.
 *
 * Everything that can be built once is built here, when the user's module loads, and never again:
 *
 * - the registry of the sites, which reads them from D1 (ADR-033) at the start of each request,
 *   call, cron run and batch. A config of 0.x is turned into definitions here, so one that cannot
 *   move throws its `ConfigError` at startup, and is written to D1 on the first request. The
 *   deployment serves every site of D1 with a definition, and a token, a grant or a call names one;
 * - the MCP endpoint, whose tool schemas are converted once, and the Hono app of the gateway,
 *   which is `fetch`: MCP at `/mcp` behind the guard and the token check, and the other routes
 *   (`http/gateway.ts`);
 * - the `Hollware` class for the user's Worker to export, the read-only RPC surface
 *   (`rpc/entrypoint.ts`).
 *
 * Both surfaces run the same handlers on a store of their own: MCP on the primary database, RPC
 * on a replica session and the published view. Every log line, those of the MCP endpoint
 * included, is one JSON line written with `console.log`.
 */
export function createHollwareWith(
  config: HollwareConfig | undefined,
  handlers: Handlers,
  options: ComposeOptions = {},
): HollwareWorker {
  const clock = options.clock ?? systemClock
  // The sites live in D1 (ADR-033). A config of 0.x is checked here, so that one that cannot
  // move fails at startup with what to change, and moves into D1 on the first request.
  // Sites of a config are resolved first, so that a broken one says what is wrong as it always
  // has; a config of options alone (`auth`) has none to move.
  const moving = config?.sites !== undefined
  if (moving) resolveConfig(config)
  const registry = createSiteRegistry({
    ...(moving ? { seed: definitionsFromConfig(config) } : {}),
    now: () => clock.now(),
    log: writeLog,
  })
  const { sites } = registry
  const refresh = (db: D1Database, options?: { readonly force?: boolean }) =>
    registry.refresh(db, options)
  const mcp = createMcpEndpoint({ handlers, serverInfo: SERVER_INFO, log: writeLog })
  const deliveryDeps = (env: HollwareEnv, site: ResolvedSite): DeliveryDeps => ({
    db: connect(env.DB),
    site,
    clock,
    fetch: (request) => fetch(request),
    secret: (name) => {
      const value: unknown = Reflect.get(env, name)
      return typeof value === 'string' ? value : undefined
    },
    semantic: semanticOfEnv(env),
    ownSecret: async (webhook) => {
      const master = env.HOLLWARE_SECRET
      if (master === undefined) return undefined
      const sealed = await createSecretStore(env.DB, () => clock.now()).read(
        site.key,
        `webhook:${webhook}`,
      )
      return sealed === null ? undefined : ((await unseal(master, sealed)) ?? undefined)
    },
  })
  return {
    fetch: createGateway({
      sites,
      siteKeys: registry.keys,
      refresh,
      mcp,
      clock,
      log: writeLog,
      read: (env) => createRpc({ sites, handlers, clock, log: writeLog }, env),
      auth: { dynamicClientRegistration: config?.auth?.dynamicClientRegistration ?? false },
      handlers,
    }),
    // The cron trigger: publishes what was scheduled and is due (ADR-025), site by site.
    scheduled: async (controller, env, ctx) => {
      const each = async (site: ResolvedSite) => {
        await runDueSchedules({
          site,
          store: createD1Store(env.DB, { clock }),
          handlers,
          clock,
          log: writeLog,
        })
        // Then the outbox, which holds the events of what was just published, too.
        await sweepOutbox({ queue: env.EVENTS, deps: deliveryDeps(env, site) })
        // And the vectors that no event brought in line (v0.5), a few entries each minute.
        const semantic = semanticOfEnv(env)
        if (semantic !== null) {
          const now = clock.now().toISOString()
          await healVectors(connect(env.DB), semantic, { site: site.key, now })
          await refreshRelated(connect(env.DB), semantic, { site: site.key, now })
        }
      }
      const agents: unknown = env.AGENTS
      const run: unknown =
        typeof agents === 'object' && agents !== null ? Reflect.get(agents, 'run') : undefined
      if (typeof run === 'function' && wakesAgents(controller.scheduledTime)) {
        ctx.waitUntil(
          Promise.resolve(Reflect.apply(run, agents, [])).catch((error: unknown) => {
            writeLog({ kind: 'agents_failed', message: String(error) })
          }),
        )
      }
      ctx.waitUntil(
        (async () => {
          // What of sign-in has expired, once a run for the whole deployment (T-11).
          await dropExpired(connect(env.DB), clock.now()).catch((error: unknown) => {
            writeLog({ kind: 'cron_failed', site: null, message: String(error) })
          })
          await refresh(env.DB)
          // One site that fails does not keep the next one waiting.
          for (const site of sites.values()) {
            await each(site).catch((error: unknown) => {
              writeLog({ kind: 'cron_failed', site: site.key, message: String(error) })
            })
          }
        })(),
      )
    },
    // The consumer of the events Queue: delivers each event to the subscribers of its site.
    queue: async (batch, env) => {
      await refresh(env.DB)
      await consumeEvents(batch.messages, (key) => {
        const site = sites.get(key)
        return site === undefined ? undefined : deliveryDeps(env, site)
      })
    },
    Hollware: createEntrypoint({ sites, refresh, handlers, clock, log: writeLog }),
  }
}
