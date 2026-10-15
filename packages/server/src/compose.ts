import { resolveConfig, type HollwareConfig, type ResolvedSite } from '@hollware/core'
import manifest from '../package.json' with { type: 'json' }
import { createGateway } from './http/index.ts'
import type { HollwareEnv, HollwareWorker } from './index.ts'
import { createMcpEndpoint } from './mcp/index.ts'
import type { Handlers } from './ops/types.ts'
import type { Clock } from './ports.ts'
import { connect } from './db/d1.ts'
import { createD1Store } from './db/index.ts'
import type { DeliveryDeps } from './events/deliver.ts'
import { consumeEvents, sweepOutbox } from './events/run.ts'
import { createEntrypoint, createRpc } from './rpc/index.ts'
import { runDueSchedules } from './schedule/run.ts'
import { semanticOfEnv } from './semantic/cloudflare.ts'
import { healVectors } from './semantic/index-entry.ts'

export interface ComposeOptions {
  /**
   * The time of every request: a token's expiry, the hour of `last_used_at` and every write are
   * read from it, each time a request needs it and not once at startup. The system clock when
   * absent; tests fix it.
   */
  readonly clock?: Clock
}

const systemClock: Clock = { now: () => new Date() }

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
 * - the config is resolved with `resolveConfig`, so a broken `hollware.config.ts` throws its
 *   `ConfigError` here, and the Worker fails at startup with a message that says what to change.
 *   The deployment serves every site of the config, and a token, a grant or a call names one;
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
  config: HollwareConfig,
  handlers: Handlers,
  options: ComposeOptions = {},
): HollwareWorker {
  const resolved = resolveConfig(config)
  const sites = resolved.sites
  const clock = options.clock ?? systemClock
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
  })
  return {
    fetch: createGateway({
      sites,
      mcp,
      clock,
      log: writeLog,
      read: (env) => createRpc({ sites, handlers, clock, log: writeLog }, env),
      auth: resolved.auth,
      handlers,
    }),
    // The cron trigger: publishes what was scheduled and is due (ADR-025), site by site.
    scheduled: async (_controller, env, ctx) => {
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
          await healVectors(connect(env.DB), semantic, {
            site: site.key,
            now: clock.now().toISOString(),
          })
        }
      }
      ctx.waitUntil(
        (async () => {
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
      await consumeEvents(batch.messages, (key) => {
        const site = sites.get(key)
        return site === undefined ? undefined : deliveryDeps(env, site)
      })
    },
    Hollware: createEntrypoint({ sites, handlers, clock, log: writeLog }),
  }
}
