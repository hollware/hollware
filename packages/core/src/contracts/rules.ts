import { documentText } from '../search/chunks.ts'
import { registerBuiltIn } from './registry.ts'
import { count, isRecord, quote } from './text.ts'
import type { Contract, ContractContext, ContractFinding, Severity } from './types.ts'

interface RuleOptions {
  readonly severity?: Severity
  readonly id?: string
}

export interface FieldLengthParams {
  readonly field: string
  readonly min?: number
  readonly max?: number
  readonly unless?: string
}

function present(frontmatter: unknown, field: string): unknown {
  return isRecord(frontmatter) ? frontmatter[field] : undefined
}

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function lengthOf(value: unknown): number | undefined {
  if (typeof value === 'string') return [...GRAPHEMES.segment(value)].length
  return Array.isArray(value) ? value.length : undefined
}

export function fieldLength(
  params: FieldLengthParams,
  options: RuleOptions = {},
): Contract<unknown> {
  const bounds = [
    params.min === undefined ? null : `at least ${params.min}`,
    params.max === undefined ? null : `at most ${params.max}`,
  ].filter((bound) => bound !== null)
  const unless = params.unless === undefined ? '' : `, unless ${quote(params.unless)} is given`
  return registerBuiltIn(
    {
      id: options.id ?? 'field-length',
      severity: options.severity ?? 'error',
      description: `${quote(params.field)} has ${bounds.join(' and ')} characters or items${unless}.`,
      rule: { name: 'field-length', params: { ...params } },
      check: ({ frontmatter }) => {
        const value = present(frontmatter, params.field)
        const length = lengthOf(value)
        if (length === undefined) return []
        const unit = typeof value === 'string' ? 'character' : 'item'
        if (params.unless !== undefined && present(frontmatter, params.unless) !== undefined)
          return []
        const path = `/frontmatter/${params.field}`
        if (params.max !== undefined && length > params.max) {
          return [
            {
              path,
              message: `${quote(params.field)} has ${count(length, unit)}; the most is ${params.max}.`,
              fix: `Shorten ${quote(params.field)} to ${count(params.max, unit)} or fewer${params.unless === undefined ? '' : `, or add ${quote(params.unless)}`}.`,
            },
          ]
        }
        if (params.min !== undefined && length < params.min) {
          return [
            {
              path,
              message: `${quote(params.field)} has ${count(length, unit)}; the least is ${params.min}.`,
              fix: `Lengthen ${quote(params.field)} to ${count(params.min, unit)} or more.`,
            },
          ]
        }
        return []
      },
    },
    { readsFrontmatter: true },
  )
}

export interface FieldPatternParams {
  readonly field: string
  readonly pattern: string
  readonly description: string
}

export function fieldPattern(
  params: FieldPatternParams,
  options: RuleOptions = {},
): Contract<unknown> {
  const pattern = new RegExp(`^(?:${params.pattern})$`, 'u')
  return registerBuiltIn(
    {
      id: options.id ?? 'field-pattern',
      severity: options.severity ?? 'error',
      description: `${quote(params.field)} is ${params.description}.`,
      rule: { name: 'field-pattern', params: { ...params } },
      check: ({ frontmatter }) => {
        const value = present(frontmatter, params.field)
        if (typeof value !== 'string' || pattern.test(value)) return []
        return [
          {
            path: `/frontmatter/${params.field}`,
            message: `${quote(params.field)} is not ${params.description}.`,
            fix: `Write ${quote(params.field)} as ${params.description}.`,
          },
        ]
      },
    },
    { readsFrontmatter: true },
  )
}

export interface RequiredToPublishParams {
  readonly fields: readonly string[]
}

export function requiredToPublish(
  params: RequiredToPublishParams,
  options: RuleOptions = {},
): Contract<unknown> {
  const empty = (value: unknown) =>
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim() === '') ||
    (Array.isArray(value) && value.length === 0)
  return registerBuiltIn(
    {
      id: options.id ?? 'required-to-publish',
      severity: options.severity ?? 'error',
      phases: ['publish'],
      description: `To publish, ${params.fields.map(quote).join(', ')} must have a value.`,
      rule: { name: 'required-to-publish', params: { fields: [...params.fields] } },
      check: ({ frontmatter }) =>
        params.fields
          .filter((field) => empty(present(frontmatter, field)))
          .map((field) => ({
            path: `/frontmatter/${field}`,
            message: `${quote(field)} is empty, and the entry cannot be published without it.`,
            fix: `Give ${quote(field)} a value, then publish.`,
          })),
    },
    { readsFrontmatter: true },
  )
}

export interface BannedWordsParams {
  readonly words: readonly string[]
  readonly reason?: string
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function bannedWords(
  params: BannedWordsParams,
  options: RuleOptions = {},
): Contract<unknown> {
  const words = params.words.filter((word) => word.trim() !== '')
  const pattern =
    words.length === 0
      ? null
      : new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.map(escape).join('|')})(?![\\p{L}\\p{N}])`, 'giu')
  const because = params.reason === undefined ? '' : ` (${params.reason})`
  const found = (text: string) => [
    ...new Set([...text.matchAll(pattern ?? /$^/g)].map((m) => m[0])),
  ]
  return registerBuiltIn(
    {
      id: options.id ?? 'banned-words',
      severity: options.severity ?? 'error',
      description: `None of these words: ${words.map(quote).join(', ')}${because}.`,
      rule: { name: 'banned-words', params: { ...params, words: [...params.words] } },
      check: (context: ContractContext<unknown>) => {
        if (pattern === null) return []
        const findings: ContractFinding[] = []
        const frontmatter = isRecord(context.frontmatter) ? context.frontmatter : {}
        for (const [field, value] of Object.entries(frontmatter)) {
          if (typeof value !== 'string') continue
          for (const word of found(value)) {
            findings.push({
              path: `/frontmatter/${field}`,
              message: `${quote(field)} uses ${quote(word)}.`,
              fix: `Write ${quote(field)} without ${quote(word)}${because}.`,
            })
          }
        }
        for (const word of found(documentText(context.markdown.document))) {
          findings.push({
            path: '/body',
            message: `The body uses ${quote(word)}.`,
            fix: `Rewrite the body without ${quote(word)}${because}.`,
          })
        }
        return findings
      },
    },
    { readsFrontmatter: false },
  )
}

export interface ReferenceParams {
  /** The field that holds the slug of the entry it refers to, or a list of slugs. */
  readonly field: string
  /** The collection of the entries it refers to. */
  readonly collection: string
  /** Their locale, when every entry refers to one locale (authors written once); its own otherwise. */
  readonly locale?: string
}

/** The slugs a field holds: one text, or a list of texts; anything else is the schema's to report. */
export function referencedSlugs(value: unknown): string[] {
  if (typeof value === 'string') return value === '' ? [] : [value]
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item !== '')
    : []
}

export function reference(params: ReferenceParams, options: RuleOptions = {}): Contract<unknown> {
  const where = params.locale === undefined ? '' : ` in ${params.locale}`
  return registerBuiltIn(
    {
      id: options.id ?? 'reference',
      severity: options.severity ?? 'error',
      description: `${quote(params.field)} names entries of ${quote(params.collection)}${where} by their slug; to publish, they must be published.`,
      rule: { name: 'reference', params: { ...params } },
      async check(context) {
        const slugs = referencedSlugs(present(context.frontmatter, params.field))
        if (slugs.length === 0) return []
        const locale = params.locale ?? context.locale
        const found = await context.entries.lookupMany(
          slugs.map((slug) => ({ collection: params.collection, locale, slug })),
        )
        const findings: ContractFinding[] = []
        slugs.forEach((slug, index) => {
          const entry = found[index] ?? null
          const path = `/frontmatter/${params.field}${typeof present(context.frontmatter, params.field) === 'string' ? '' : `/${index}`}`
          if (entry === null) {
            findings.push({
              path,
              message: `${quote(params.field)} names ${quote(slug)}, and ${quote(params.collection)} has no entry ${quote(slug)}${where === '' ? ` in ${locale}` : where}.`,
              fix: `Use the slug of an entry of ${quote(params.collection)} (list_entries lists them), or create ${quote(slug)} first.`,
            })
          } else if (context.phase === 'publish' && entry.status !== 'published') {
            findings.push({
              path,
              message: `${quote(params.field)} names ${quote(slug)} of ${quote(params.collection)}, which is not published.`,
              fix: `Publish ${quote(slug)} of ${quote(params.collection)} first, or publish both in one group.`,
            })
          }
        })
        return findings
      },
    },
    { readsFrontmatter: true },
  )
}
