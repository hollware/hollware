import * as z from 'zod'
import { contracts } from './opt-in.ts'
import { bannedWords, fieldLength, fieldPattern, reference, requiredToPublish } from './rules.ts'
import type { Contract, Severity } from './types.ts'

const fieldName = z.string().min(1).describe('A field of the frontmatter, by its name.')

const NO_PARAMS = z.strictObject({})

function isValidPattern(pattern: string): boolean {
  try {
    new RegExp(pattern, 'u')
    return true
  } catch {
    return false
  }
}

/** A rule of the catalog. */
export interface CatalogRule {
  readonly name: string
  readonly description: string
  readonly params: z.ZodType<Readonly<Record<string, unknown>>>
  make(
    params: Readonly<Record<string, unknown>>,
    severity: Severity,
    id?: string,
  ): Contract<unknown>
}

function rule<Schema extends z.ZodType<Readonly<Record<string, unknown>>>>(
  name: string,
  description: string,
  params: Schema,
  make: (
    params: z.output<Schema>,
    options: { severity: Severity; id?: string },
  ) => Contract<unknown>,
): CatalogRule {
  return {
    name,
    description,
    params,
    make: (raw, severity, id) =>
      make(params.parse(raw), { severity, ...(id === undefined ? {} : { id }) }),
  }
}

export const CATALOG: readonly CatalogRule[] = [
  rule(
    'banned-words',
    'Words that may appear neither in a text field of the frontmatter nor in the body.',
    z.strictObject({
      words: z.array(z.string().min(1)).min(1).max(200),
      reason: z.string().min(1).max(200).optional().describe('Why, for the fix.'),
    }),
    (params, options) => bannedWords(params, options),
  ),
  rule(
    'field-length',
    'A text field has between min and max characters, or a list between min and max items; unless names a field that lifts the rule when given.',
    z
      .strictObject({
        field: fieldName,
        min: z.number().int().min(0).optional(),
        max: z.number().int().min(0).optional(),
        unless: fieldName.optional(),
      })
      .refine((params) => params.min !== undefined || params.max !== undefined, {
        message: 'Give min, max or both.',
      })
      .refine(
        (params) =>
          params.min === undefined || params.max === undefined || params.min <= params.max,
        {
          message: 'min is more than max.',
        },
      ),
    (params, options) => fieldLength(params, options),
  ),
  rule(
    'field-pattern',
    'A text field matches a regular expression, as a whole.',
    z.strictObject({
      field: fieldName,
      pattern: z
        .string()
        .min(1)
        .max(500)
        .refine(isValidPattern, { message: 'Not a regular expression.' }),
      description: z.string().min(1).max(200).describe('What the pattern asks for, in words.'),
    }),
    (params, options) => fieldPattern(params, options),
  ),
  rule(
    'images-have-alt',
    'Every image has alt text that describes it.',
    NO_PARAMS,
    (_params, options) => contracts.imagesHaveAlt(options),
  ),
  rule(
    'internal-links-resolve',
    'Every link to another entry of the site points to one that exists, and is published when this one is.',
    NO_PARAMS,
    (_params, options) => contracts.internalLinksResolve(options),
  ),
  rule(
    'reference',
    'A field names entries of another collection by their slug, one or a list: they must exist, and be published to publish this one. get_entry with references reads them.',
    z.strictObject({
      field: fieldName,
      collection: z
        .string()
        .regex(/^[a-z][a-z0-9-]{0,62}$/)
        .describe('The collection of the entries it names.'),
      locale: z
        .string()
        .min(2)
        .max(35)
        .optional()
        .describe('Their locale, when all of them are in one; the locale of this entry otherwise.'),
    }),
    (params, options) => reference(params, options),
  ),
  rule(
    'required-to-publish',
    'Fields a draft may leave empty and a published entry must fill.',
    z.strictObject({ fields: z.array(fieldName).min(1) }),
    (params, options) => requiredToPublish(params, options),
  ),
  rule(
    'translation-pair',
    'Every locale of the site has an entry in the translation group of this one, to publish.',
    NO_PARAMS,
    (_params, options) => contracts.translationPair(options),
  ),
]

/** A rule of the catalog by its name, or `undefined`. */
export function catalogRule(name: string): CatalogRule | undefined {
  return CATALOG.find((candidate) => candidate.name === name)
}

/** The catalog as `describe_site` shows it: each rule with the JSON Schema of its parameters. */
export function describeCatalog(): {
  name: string
  description: string
  params: Record<string, unknown>
}[] {
  return CATALOG.map((entry) => ({
    name: entry.name,
    description: entry.description,
    params: z.toJSONSchema(entry.params, { target: 'draft-2020-12', io: 'input' }),
  }))
}
