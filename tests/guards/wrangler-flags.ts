import { parseJsonc } from '../support/jsonc.ts'
import { isRecord } from '../support/values.ts'
import type { TextFile, Violation } from './types.ts'

/**
 * Guard `wrangler-flags`: every Worker of the repository runs without Node.js compatibility,
 * which Workers turn on by default from the 2026-08-04 compatibility date. Each
 * `wrangler.jsonc` lists both `no_nodejs_compat` and `no_nodejs_compat_v2` (one alone leaves
 * `process` and `Buffer` in place) and neither positive flag. The starter, which becomes the
 * user's project, opts out too.
 *
 * Hollware's own configs also set `"send_metrics": false`, so no command run in this
 * repository sends wrangler's telemetry. A template is the user's project: its telemetry is the
 * user's choice.
 *
 * A Worker of Hollware, which is one with the D1 binding `DB`, holds the OAuth server (ADR-026):
 * it lists `global_fetch_strictly_public`, without which the server would fetch a client's
 * metadata document through the zone and refuses to take such documents, and it binds `OAUTH_KV`,
 * at the top and in every environment that names its own bindings (bindings do not inherit).
 */

export interface WranglerFlagsInput {
  /** Every `wrangler.jsonc` of the repository. */
  configs: readonly TextFile[]
}

/** The flags that turn Node.js compatibility off; both are needed. */
const OPT_OUTS = ['no_nodejs_compat', 'no_nodejs_compat_v2']

/** The flags that would turn it back on. */
const OPT_INS = ['nodejs_compat', 'nodejs_compat_v2']

/** Whether a set of bindings (the top of a config, or one environment) has the D1 binding `DB`. */
function bindsHollware(bindings: Record<string, unknown>): boolean {
  const databases = bindings.d1_databases
  return (
    Array.isArray(databases) &&
    databases.some((database) => isRecord(database) && database.binding === 'DB')
  )
}

function bindsOAuthKv(bindings: Record<string, unknown>): boolean {
  const namespaces = bindings.kv_namespaces
  return (
    Array.isArray(namespaces) &&
    namespaces.some((namespace) => isRecord(namespace) && namespace.binding === 'OAUTH_KV')
  )
}

export function checkWranglerFlags(input: WranglerFlagsInput): Violation[] {
  const violations: Violation[] = []
  for (const config of input.configs) {
    const report = (rule: string, message: string): void => {
      violations.push({ rule: `wrangler-flags/${rule}`, file: config.path, message })
    }
    const parsed = parseJsonc(config.text)
    if (!parsed.ok || !isRecord(parsed.value)) {
      report('invalid', 'the file is not valid JSONC holding an object')
      continue
    }
    const flags = parsed.value.compatibility_flags
    const listed = Array.isArray(flags) ? flags.filter((flag) => typeof flag === 'string') : []
    const missing = OPT_OUTS.filter((flag) => !listed.includes(flag))
    if (missing.length > 0) {
      report(
        'node-compat',
        `"compatibility_flags" must list ${JSON.stringify(OPT_OUTS)}: Node.js compatibility is on by default from the 2026-08-04 compatibility date, and Hollware runs without it; missing ${JSON.stringify(missing)}`,
      )
    }
    const enabling = OPT_INS.filter((flag) => listed.includes(flag))
    if (enabling.length > 0) {
      report(
        'node-compat',
        `"compatibility_flags" turns Node.js compatibility on with ${JSON.stringify(enabling)}: Hollware runs without it`,
      )
    }
    if (bindsHollware(parsed.value)) {
      if (!listed.includes('global_fetch_strictly_public')) {
        report(
          'oauth',
          '"compatibility_flags" must list "global_fetch_strictly_public": the OAuth server fetches the metadata documents of clients over the public internet only',
        )
      }
      const environments = isRecord(parsed.value.env) ? Object.entries(parsed.value.env) : []
      const places: [string, Record<string, unknown>][] = [
        ['the top of the config', parsed.value],
        ...environments.flatMap(([name, bindings]): [string, Record<string, unknown>][] =>
          isRecord(bindings) && bindsHollware(bindings) ? [[`env.${name}`, bindings]] : [],
        ),
      ]
      for (const [place, bindings] of places) {
        if (!bindsOAuthKv(bindings)) {
          report(
            'oauth',
            `${place} must bind a KV namespace as "OAUTH_KV": the OAuth server keeps its clients, grants and tokens there`,
          )
        }
      }
    }
    if (!config.path.startsWith('templates/') && parsed.value.send_metrics !== false) {
      report(
        'send-metrics',
        `"send_metrics" must be false, so no wrangler command of this repository sends telemetry, found ${JSON.stringify(parsed.value.send_metrics)}`,
      )
    }
  }
  return violations
}
