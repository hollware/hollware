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
 * There it also declares a cron trigger and consumes a queue with a `dead_letter_queue`, unless
 * `WORKERS_WITHOUT_EVENTS` names the config.
 */

export interface WranglerFlagsInput {
  /** Every `wrangler.jsonc` of the repository. */
  configs: readonly TextFile[]
  workersWithoutEvents: readonly string[]
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

function triggersCron(bindings: Record<string, unknown>): boolean {
  const triggers = bindings.triggers
  return isRecord(triggers) && Array.isArray(triggers.crons) && triggers.crons.length > 0
}

function consumesWithDeadLetters(bindings: Record<string, unknown>): boolean {
  const queues = bindings.queues
  return (
    isRecord(queues) &&
    Array.isArray(queues.consumers) &&
    queues.consumers.some(
      (consumer) =>
        isRecord(consumer) &&
        typeof consumer.dead_letter_queue === 'string' &&
        consumer.dead_letter_queue !== '',
    )
  )
}

export function checkWranglerFlags(input: WranglerFlagsInput): Violation[] {
  const violations: Violation[] = []
  const excusedWithReason = new Set<string>()
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
      const excused = input.workersWithoutEvents.includes(config.path)
      const lacksEvents = places.some(
        ([, bindings]) => !triggersCron(bindings) || !consumesWithDeadLetters(bindings),
      )
      if (excused && lacksEvents) excusedWithReason.add(config.path)
      for (const [place, bindings] of places) {
        if (!bindsOAuthKv(bindings)) {
          report(
            'oauth',
            `${place} must bind a KV namespace as "OAUTH_KV": the OAuth server keeps its clients, grants and tokens there`,
          )
        }
        if (excused) continue
        if (!triggersCron(bindings)) {
          report(
            'events',
            `${place} must declare a cron trigger: it publishes the scheduled entries whose time has come`,
          )
        }
        if (!consumesWithDeadLetters(bindings)) {
          report(
            'events',
            `${place} must consume a queue with a "dead_letter_queue": it delivers the publication events and keeps the ones it could not`,
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
  for (const path of input.workersWithoutEvents) {
    if (!excusedWithReason.has(path)) {
      violations.push({
        rule: 'wrangler-flags/stale-exception',
        file: 'tests/guards/exceptions.ts',
        message: `WORKERS_WITHOUT_EVENTS names ${path}, which is no Worker of Hollware without its cron trigger or dead-letter queue: remove it`,
      })
    }
  }
  return violations
}
