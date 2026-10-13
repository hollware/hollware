import { resolveConfig, type HollwareConfig } from '@hollware/core'
import manifest from '../package.json' with { type: 'json' }
import { createGateway } from './http/index.ts'
import type { HollwareWorker } from './index.ts'
import { createMcpEndpoint } from './mcp/index.ts'
import type { Handlers } from './ops/types.ts'
import type { Clock } from './ports.ts'
import { createEntrypoint } from './rpc/index.ts'

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
 *   v0.1 serves the one site of the config;
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
  const [site] = resolveConfig(config).sites.values()
  if (site === undefined) {
    // `resolveConfig` throws for a config without exactly one site; this is only for the types.
    throw new Error('The resolved config has no site, which resolveConfig never lets through')
  }
  const clock = options.clock ?? systemClock
  const mcp = createMcpEndpoint({ handlers, serverInfo: SERVER_INFO, log: writeLog })
  return {
    fetch: createGateway({ site, mcp, clock, log: writeLog }),
    Hollware: createEntrypoint({ site, handlers, clock, log: writeLog }),
  }
}
