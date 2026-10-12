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
 */

export interface WranglerFlagsInput {
  /** Every `wrangler.jsonc` of the repository. */
  configs: readonly TextFile[]
}

/** The flags that turn Node.js compatibility off; both are needed. */
const OPT_OUTS = ['no_nodejs_compat', 'no_nodejs_compat_v2']

/** The flags that would turn it back on. */
const OPT_INS = ['nodejs_compat', 'nodejs_compat_v2']

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
    if (!config.path.startsWith('templates/') && parsed.value.send_metrics !== false) {
      report(
        'send-metrics',
        `"send_metrics" must be false, so no wrangler command of this repository sends telemetry, found ${JSON.stringify(parsed.value.send_metrics)}`,
      )
    }
  }
  return violations
}
