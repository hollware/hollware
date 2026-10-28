import type { Hollware } from './hollware.ts'
import { entriesOf } from './listing.ts'
import { mapMemory, type Memory } from './memory.ts'
import { list, number, record, text, type Json } from './read.ts'

/** Where the weekly report goes: a draft in a collection of the site, and a webhook if set. */
export interface ReportOptions {
  readonly collection: string
  readonly locale: string
  /** The frontmatter of the report of a day (YYYY-MM-DD), as the collection's schema asks. */
  readonly frontmatter?: (day: string) => Readonly<Record<string, string>>
}

export interface AuditorDeps {
  readonly hollware: Hollware
  readonly webhook?: ((report: string) => Promise<void>) | undefined
}

export interface AuditOptions {
  readonly report: ReportOptions
  /** The day of the report, YYYY-MM-DD. */
  readonly day: string
  /** An entry read this much but not updated in these many days is out of date. */
  readonly staleDays?: number
}

export interface Finding {
  readonly kind: 'stale' | 'contract'
  readonly where: string
  readonly what: string
}

function yamlValue(value: string): string {
  return JSON.stringify(value)
}

export function reportOf(day: string, findings: readonly Finding[], report: ReportOptions): string {
  const frontmatter = report.frontmatter?.(day) ?? {
    title: `Content audit of ${day}`,
    description: `What the weekly audit of ${day} found: read but old, and failing contracts.`,
  }
  const lines = [
    '---',
    ...Object.entries(frontmatter).map(([key, value]) => `${key}: ${yamlValue(value)}`),
    '---',
    '',
  ]
  lines.push(`# Content audit of ${day}`, '')
  const stale = findings.filter((finding) => finding.kind === 'stale')
  const failing = findings.filter((finding) => finding.kind === 'contract')
  lines.push('## Read a lot, updated long ago', '')
  lines.push(
    ...(stale.length === 0
      ? ['Nothing.']
      : stale.map((finding) => `- ${finding.where}: ${finding.what}`)),
    '',
  )
  lines.push('## Published, and failing the contracts now', '')
  lines.push(
    ...(failing.length === 0
      ? ['Nothing.']
      : failing.map((finding) => `- ${finding.where}: ${finding.what}`)),
    '',
  )
  return lines.join('\n')
}

function problemsOf(verdict: Json): string[] {
  return [...list(verdict['errors']), ...list(verdict['warnings'])].map(
    (problem) =>
      `${String(problem['severity'])} ${String(problem['contract'])}: ${String(problem['message'])}`,
  )
}

export const AUDIT_STATE = 'audit:state'

export interface AuditState {
  readonly offset: number
  readonly found: Readonly<
    Record<string, { readonly problems: readonly string[]; readonly at: string }>
  >
}

function stateOf(text_: string | null): AuditState {
  if (text_ === null) return { offset: 0, found: {} }
  try {
    const parsed = record(JSON.parse(text_))
    return {
      offset: number(parsed['offset']) ?? 0,
      found: Object.fromEntries(
        Object.entries(record(parsed['found'])).map(([key, value]) => {
          const one = record(value)
          const problems = Array.isArray(one['problems']) ? one['problems'].map(String) : []
          return [key, { problems, at: text(one['at']) ?? '' }]
        }),
      ),
    }
  } catch {
    return { offset: 0, found: {} }
  }
}

export interface StepDeps {
  readonly hollware: Hollware
  readonly memory: Memory
}

/**
 * One step of the audit: the next `perRun` published entries of the site (outside the report's
 * collection), each checked against the contracts as they are now, and what was found kept in the
 * memory. A step reads a dozen entries, two calls each, so that a run stays within the fifty calls
 * a free Worker has; the steps go round the entries, and the report is written from them.
 */
export async function auditStep(
  deps: StepDeps,
  options: { readonly report: ReportOptions; readonly now: string; readonly perRun?: number },
): Promise<{ readonly checked: number }> {
  const perRun = options.perRun ?? 12
  const site = record((await deps.hollware.call('describe_site', {}))['site'])
  const refs: { collection: string; locale: string; slug: string }[] = []
  for (const collection of list(site['collections'])) {
    const name = text(collection['name'])
    if (name === null || name === options.report.collection) continue
    for (const entry of await entriesOf(deps.hollware, { collection: name, status: 'published' })) {
      const locale = text(entry['locale'])
      const slug = text(entry['slug'])
      if (locale !== null && slug !== null) refs.push({ collection: name, locale, slug })
    }
  }
  const state = stateOf(await deps.memory.get(AUDIT_STATE))
  const found = { ...state.found }
  const count = Math.min(perRun, refs.length)
  for (let step = 0; step < count; step++) {
    const ref = refs[(state.offset + step) % refs.length]
    if (ref === undefined) continue
    const markdown = text(
      record((await deps.hollware.call('get_entry', { ...ref, published: true }))['entry'])[
        'markdown'
      ],
    )
    if (markdown === null) continue
    const verdict = record((await deps.hollware.call('validate', { ...ref, markdown }))['verdict'])
    found[`${ref.collection}/${ref.locale}/${ref.slug}`] = {
      problems: problemsOf(verdict),
      at: options.now,
    }
  }
  const offset = refs.length === 0 ? 0 : (state.offset + count) % refs.length
  await deps.memory.put(AUDIT_STATE, JSON.stringify({ offset, found }), 30 * 86_400)
  return { checked: count }
}

/**
 * The report of the audit: the most read pages whose entry has not changed in `staleDays`, and
 * what the steps of the last eight days found. It is saved as a draft (never published) in the
 * report's collection, its slug the day, and posted to the webhook when there is one.
 */
export async function writeReport(
  deps: AuditorDeps & StepDeps,
  options: AuditOptions,
): Promise<{ readonly findings: number }> {
  const staleDays = options.staleDays ?? 180
  const findings: Finding[] = []
  const stats = await deps.hollware.call('content_stats', { days: 30, limit: 20 })
  const cutoff = Date.parse(options.day) - staleDays * 86_400_000
  for (const page of list(stats['pages'])) {
    const entry = record(page['entry'])
    const updated = text(entry['updatedAt'])
    if (updated === null || Date.parse(updated) > cutoff) continue
    findings.push({
      kind: 'stale',
      where: `${String(page['path'])} (${String(entry['collection'])}/${String(entry['locale'])}/${String(entry['slug'])})`,
      what: `${number(page['views']) ?? 0} views in 30 days, last updated ${updated.slice(0, 10)}`,
    })
  }
  const since = Date.parse(options.day) - 8 * 86_400_000
  const state = stateOf(await deps.memory.get(AUDIT_STATE))
  for (const [where, { problems, at }] of Object.entries(state.found).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (Date.parse(at) < since) continue
    for (const problem of problems) findings.push({ kind: 'contract', where, what: problem })
  }
  const report = reportOf(options.day, findings, options.report)
  const slug = `audit-${options.day}`
  const where = { collection: options.report.collection, locale: options.report.locale, slug }
  const existing = record((await deps.hollware.call('get_entry', where))['entry'])
  if (text(existing['id']) === null) {
    await deps.hollware.call('create_draft', { ...where, markdown: report })
  } else {
    await deps.hollware.call('update_draft', {
      id: existing['id'],
      version: existing['version'],
      markdown: report,
    })
  }
  await deps.webhook?.(report)
  return { findings: findings.length }
}

/** A whole audit at once, every published entry and then the report: for a site with few entries. */
export async function audit(
  deps: AuditorDeps & Partial<StepDeps>,
  options: AuditOptions,
): Promise<{ readonly findings: number }> {
  const memory = deps.memory ?? mapMemory()
  await auditStep(
    { hollware: deps.hollware, memory },
    {
      report: options.report,
      now: `${options.day}T00:00:00.000Z`,
      perRun: Number.POSITIVE_INFINITY,
    },
  )
  return writeReport({ ...deps, memory }, options)
}
