import { documentText } from '../search/chunks.ts'
import { registerBuiltIn } from './registry.ts'
import { count, isRecord, quote } from './text.ts'
import type { Contract, ContractContext, ContractFinding, Severity } from './types.ts'

/**
 * The generic rules of the catalog (ADR-033): what a site asks of its entries without writing
 * code, each one data with parameters. A rule reads a field of the frontmatter by its name, at
 * the top of it; one that is absent or of another type is the schema's to report, so the rule
 * passes it.
 */

interface RuleOptions {
  readonly severity?: Severity
  /** The id of the contract, when a collection has this rule twice: `field-length` otherwise. */
  readonly id?: string
}

export interface FieldLengthParams {
  readonly field: string
  readonly min?: number
  readonly max?: number
  /** A field whose presence lifts the rule: a title may be long when a `seoTitle` is given. */
  readonly unless?: string
}

function present(frontmatter: unknown, field: string): unknown {
  return isRecord(frontmatter) ? frontmatter[field] : undefined
}

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** The length of a value as a reader counts it: characters of a text (an emoji is one), items of a list. */
function lengthOf(value: unknown): number | undefined {
  if (typeof value === 'string') return [...GRAPHEMES.segment(value)].length
  return Array.isArray(value) ? value.length : undefined
}

/** A text, or a list, of a field has between `min` and `max` characters or items. */
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
  /** A regular expression (Unicode) the whole text must match. */
  readonly pattern: string
  /** What the pattern asks for, in words: `a slug of lowercase words`. */
  readonly description: string
}

/** A text field matches a pattern. */
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

/** Fields a draft may lack and a published entry must have, with something in them. */
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
  /** Why the words are out, for the fix: `the brand is spelled Hollware`. */
  readonly reason?: string
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Words that may appear neither in a text field of the frontmatter nor in the body. */
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
