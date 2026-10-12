import { parseJsonc } from '../support/jsonc.ts'
import { isRecord } from '../support/values.ts'
import type { TextFile, Violation } from './types.ts'

/**
 * Guard `wrangler-dates`: a Worker's `compatibility_date` is never newer than the latest date
 * the workerd bundled with the installed wrangler supports
 * (`unstable_getDevCompatibilityDate()`). A newer date makes `wrangler dev` and the Vite
 * plugin fall back to an older one with a warning, and tests run on something else than what
 * the file says.
 *
 * Only `wrangler.jsonc` is accepted, so the guard can read every Worker config. A
 * `wrangler.toml` or `wrangler.json` would escape it, and is reported.
 */

export interface WranglerDatesInput {
  /** Every `wrangler.jsonc` of the repository. */
  configs: readonly TextFile[]
  /** Every other file named `wrangler.toml` or `wrangler.json`. */
  otherFormats: readonly string[]
  /** The newest compatibility date the installed workerd supports, `YYYY-MM-DD`. */
  latestSupported: string
}

export function checkWranglerDates(input: WranglerDatesInput): Violation[] {
  const violations: Violation[] = []
  for (const path of input.otherFormats) {
    violations.push({
      rule: 'wrangler-dates/format',
      file: path,
      message:
        'Worker configs are wrangler.jsonc only: the compatibility date of any other format is not checked',
    })
  }
  for (const config of input.configs) {
    const parsed = parseJsonc(config.text)
    if (!parsed.ok || !isRecord(parsed.value)) {
      violations.push({
        rule: 'wrangler-dates/invalid',
        file: config.path,
        message: 'the file is not valid JSONC holding an object',
      })
      continue
    }
    const date = parsed.value.compatibility_date
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      violations.push({
        rule: 'wrangler-dates/missing',
        file: config.path,
        message: `"compatibility_date" must be a YYYY-MM-DD date, found ${JSON.stringify(date)}`,
      })
    } else if (date > input.latestSupported) {
      violations.push({
        rule: 'wrangler-dates/too-new',
        file: config.path,
        message: `"compatibility_date" ${date} is newer than ${input.latestSupported}, the latest date the installed workerd supports: use ${input.latestSupported} or older`,
      })
    }
  }
  return violations
}
