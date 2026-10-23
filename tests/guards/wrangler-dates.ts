import { parseJsonc } from '../support/jsonc.ts'
import { isRecord } from '../support/values.ts'
import type { TextFile, Violation } from './types.ts'

export interface WranglerDatesInput {
  configs: readonly TextFile[]
  otherFormats: readonly string[]
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
