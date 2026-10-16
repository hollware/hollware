import * as z from 'zod'

/**
 * The definition of a site as data (ADR-033): what D1 stores for it and what the operations that
 * change the structure take. Its shape is checked here; what only makes sense of the whole (a
 * route with `:slug`, a default locale among the locales, a rule's parameters) is checked when it
 * is compiled, with one problem for each thing wrong.
 */

const jsonSchema = z
  .record(z.string(), z.unknown())
  .describe('A JSON Schema, draft 2020-12, of an object.')

const severity = z.enum(['error', 'warning'])

export const ruleDefinition = z.strictObject({
  rule: z.string().min(1).describe('The name of a rule of the catalog that describe_site lists.'),
  severity: severity.default('error'),
  params: z
    .record(z.string(), z.unknown())
    .default({})
    .describe('The parameters of the rule, as the catalog describes them.'),
  id: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .optional()
    .describe(
      'The id of the contract, when a collection lists one rule twice; its name otherwise.',
    ),
})

export const componentDefinitionData = z.strictObject({
  props: jsonSchema.describe('The JSON Schema of the props.'),
  description: z.string().min(1).optional(),
  example: z.string().min(1).optional(),
})

export const collectionDefinitionData = z.strictObject({
  schema: jsonSchema.describe('The JSON Schema of the frontmatter.'),
  routes: z
    .record(z.string(), z.string())
    .describe('The public path of an entry in each locale, with :slug: { "en": "/blog/:slug/" }.'),
  translationGroupField: z.string().min(1).nullable().default(null),
  tagsField: z.string().min(1).nullable().default(null),
  sortByField: z.string().min(1).nullable().default(null),
  components: z.record(z.string(), componentDefinitionData).default({}),
  rules: z.array(ruleDefinition).default([]),
  maxMarkdownBytes: z.number().int().positive().nullable().default(null),
  styleGuide: z.string().nullable().default(null),
})

export const webhookDefinition = z.strictObject({
  name: z.string().min(1),
  url: z.string().min(1).describe('The https URL that receives each event, signed.'),
  secret: z
    .string()
    .min(1)
    .optional()
    .describe(
      'The Worker secret that signs the deliveries. Leave it out for Hollware to make one with make_webhook_secret and keep it sealed.',
    ),
})

export const siteDefinitionData = z.strictObject({
  locales: z.array(z.string().min(1)).min(1),
  defaultLocale: z.string().min(1),
  url: z.string().min(1).nullable().default(null),
  styleGuide: z.string().nullable().default(null),
  cors: z.strictObject({ origins: z.array(z.string().min(1)) }).default({ origins: [] }),
  events: z
    .strictObject({
      webhooks: z.array(webhookDefinition).default([]),
      indexNow: z
        .strictObject({ key: z.string().min(1) })
        .nullable()
        .default(null),
    })
    .default({ webhooks: [], indexNow: null }),
  collections: z.record(z.string(), collectionDefinitionData),
})

export type RuleDefinition = z.output<typeof ruleDefinition>
export type CollectionDefinitionData = z.output<typeof collectionDefinitionData>
export type SiteDefinitionData = z.output<typeof siteDefinitionData>
/** A definition as a person or an agent writes it, with the defaults left out. */
export type SiteDefinitionInput = z.input<typeof siteDefinitionData>
