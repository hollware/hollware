import type { Hollware } from './hollware.ts'
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
  /** Posts the report as `{ "text": "<markdown>" }`, as Slack's incoming webhooks take it. */
  readonly webhook?: ((report: string) => Promise<void>) | undefined
}

export interface AuditOptions {
  readonly report: ReportOptions
  /** The day of the report, YYYY-MM-DD. */
  readonly day: string
  /** An entry read this much but not updated in these many days is out of date. */
  readonly staleDays?: number
  /** How many published entries of each collection are checked against the contracts. */
  readonly perCollection?: number
}

export interface Finding {
  readonly kind: 'stale' | 'contract'
  readonly where: string
  readonly what: string
}

function yamlValue(value: string): string {
  return JSON.stringify(value)
}

/** The report as Markdown, with its frontmatter. */
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

/**
 * The weekly audit: the most read pages whose entry has not changed in `staleDays`, and the
 * published entries that the current contracts refuse or warn about (a link to a page that is
 * gone shows up here). The report is saved as a draft (never published) in the report's
 * collection, its slug the day, and posted to the webhook when there is one. It needs no model.
 */
export async function audit(
  deps: AuditorDeps,
  options: AuditOptions,
): Promise<{ readonly findings: number }> {
  const staleDays = options.staleDays ?? 180
  const perCollection = options.perCollection ?? 50
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
  const site = record((await deps.hollware.call('describe_site', {}))['site'])
  for (const collection of list(site['collections'])) {
    const name = text(collection['name'])
    if (name === null || name === options.report.collection) continue
    const entries = list(
      (
        await deps.hollware.call('list_entries', {
          collection: name,
          status: 'published',
          limit: perCollection,
        })
      )['entries'],
    )
    for (const entry of entries) {
      const ref = { collection: name, locale: entry['locale'], slug: entry['slug'] }
      const markdown = text(
        record((await deps.hollware.call('get_entry', { ...ref, published: true }))['entry'])[
          'markdown'
        ],
      )
      if (markdown === null) continue
      const verdict = record(
        (await deps.hollware.call('validate', { ...ref, markdown }))['verdict'],
      )
      for (const problem of problemsOf(verdict)) {
        findings.push({
          kind: 'contract',
          where: `${name}/${String(entry['locale'])}/${String(entry['slug'])}`,
          what: problem,
        })
      }
    }
  }
  const report = reportOf(options.day, findings, options.report)
  const slug = `audit-${options.day}`
  const existing = record(
    (
      await deps.hollware.call('get_entry', {
        collection: options.report.collection,
        locale: options.report.locale,
        slug,
      })
    )['entry'],
  )
  if (text(existing['id']) === null) {
    await deps.hollware.call('create_draft', {
      collection: options.report.collection,
      locale: options.report.locale,
      slug,
      markdown: report,
    })
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
