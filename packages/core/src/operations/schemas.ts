import * as z from 'zod'

/**
 * The pieces the operation schemas share. Their descriptions become the JSON Schema that agents
 * read over MCP, so they are written for the agent.
 */

export const collectionName = z
  .string()
  .min(1)
  .describe('A collection of the site, as describe_site lists it.')

export const locale = z.string().min(1).describe('A locale of the site, as describe_site lists it.')

export const slug = z
  .string()
  .max(200)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .describe(
    "The entry's path segment: lowercase letters and digits joined by hyphens, such as edge-caching-guide.",
  )

export const entryId = z
  .string()
  .regex(/^ent_[0-9A-HJKMNP-TV-Z]{26}$/)
  .describe('The id of an entry (ent_…), as the other operations return it.')

export const revisionId = z
  .string()
  .regex(/^rev_[0-9A-HJKMNP-TV-Z]{26}$/)
  .describe('The id of a revision (rev_…).')

export const version = z
  .number()
  .int()
  .min(1)
  .describe(
    'The version of the entry you read. A change against an older version answers conflict.',
  )

export const markdown = z
  .string()
  .describe(
    'The whole Markdown file: the YAML frontmatter between two --- lines, then the body. The collection schema in describe_site says what the frontmatter needs.',
  )

export const entryStatus = z.enum(['draft', 'scheduled', 'published'])

export const severity = z.enum(['error', 'warning'])

export const phase = z.enum(['write', 'publish'])

export const violation = z.object({
  contract: z.string().describe('The id of the contract.'),
  severity,
  path: z
    .string()
    .describe(
      'A JSON Pointer into { frontmatter, body }: /frontmatter/title, or /body with a line.',
    ),
  message: z.string(),
  fix: z.string().describe('What to change so that the problem goes away.'),
  line: z.number().int().min(1).optional(),
})

export const verdict = z.object({
  ok: z
    .boolean()
    .describe('Whether there are no errors. Warnings do not count, but publish asks about them.'),
  phase,
  errors: z.array(violation),
  warnings: z.array(violation),
  contractsHash: z.string().describe('A hash of the rules the content was checked against.'),
})

export const acknowledgedWarning = z.object({
  contract: z.string(),
  path: z.string(),
})

export const entrySummary = z.object({
  id: entryId,
  collection: z.string(),
  locale: z.string(),
  slug: z.string(),
  translationGroup: z.string().nullable(),
  status: entryStatus,
  version: z.number().int().min(1),
  frontmatter: z.record(z.string(), z.unknown()),
  tags: z.array(z.string()),
  hasUnpublishedChanges: z
    .boolean()
    .describe('Whether the latest revision differs from the published one.'),
  publishedAt: z.string().nullable().describe('When the entry was first published, or null.'),
  scheduledAt: z
    .string()
    .nullable()
    .describe('When a scheduled entry will be published, or null for one that is not scheduled.'),
  deletedAt: z
    .string()
    .nullable()
    .describe('When the entry went to the trash, or null for one that is not in the trash.'),
  updatedAt: z.string(),
  translationOutdated: z
    .boolean()
    .optional()
    .describe(
      "For a translation (an entry in a group, in another locale than the site's default): whether its source, the entry of the group in the default locale, was changed after it. Save the translation again to bring it up to date. Absent for any other entry.",
    ),
  images: z
    .record(
      z.string(),
      z.object({
        width: z.number().int().nullable(),
        height: z.number().int().nullable(),
        srcset: z.string().nullable(),
      }),
    )
    .optional()
    .describe(
      'Where asset: references are read as URLs (a site over RPC or the read API, or the published view): the images its frontmatter names, by URL, with their size and srcset, to lay out a cover. Absent when it names none.',
    ),
})

export const publication = z.object({
  revision: revisionId,
  verdict: verdict.describe('The verdict of the publish phase.'),
  acknowledged: z.array(acknowledgedWarning).describe('The warnings acknowledged to publish.'),
  at: z.string(),
})

/** The Comark document of a revision: what a site's renderer takes. */
export const document = z.object({
  nodes: z.array(z.unknown()),
  frontmatter: z.record(z.string(), z.unknown()),
  meta: z.record(z.string(), z.unknown()),
})

export const entry = entrySummary.extend({
  revision: revisionId.describe('The revision this view shows.'),
  unpublishAt: z
    .string()
    .nullable()
    .describe('When a published entry is to be taken off the site, or null (schedule_unpublish).'),
  verdict: verdict.describe('The verdict of the contracts when this revision was written.'),
  lastPublication: publication.nullable(),
  markdown: z.string().optional(),
  document: document.optional(),
  html: z.string().optional(),
})

export const reviewId = z
  .string()
  .regex(/^rvw_[0-9A-HJKMNP-TV-Z]{26}$/)
  .describe('The id of a review (rvw_…), as publish and list_reviews return it.')

export const reviewStatus = z.enum([
  'pending',
  'approved',
  'changes_requested',
  'rejected',
  'cancelled',
])

/**
 * A request to publish a revision, made by someone who may write but not publish, and what a
 * person who may publish decided about it.
 */
export const review = z.object({
  id: reviewId,
  entryId,
  revision: revisionId.describe('The revision asked for.'),
  status: reviewStatus.describe(
    'pending until someone decides; cancelled when a new revision of the entry is saved.',
  ),
  requestedBy: z.string().describe('The user who asked.'),
  requestedByName: z
    .string()
    .nullable()
    .describe('The name of the user who asked, if they gave one.'),
  requestedAt: z.string(),
  decidedBy: z.string().nullable(),
  decidedAt: z.string().nullable(),
  note: z.string().nullable().describe('What the reviewer asked to change, or null.'),
})

/**
 * A revision of an entry in its history: who wrote it, when, what the contracts said, and whether
 * it was published. Its Markdown is read with get_revision.
 */
export const revisionSummary = z.object({
  id: revisionId,
  entryId,
  createdAt: z.string(),
  author: z.string().describe('The user who wrote it, or whose token or app their agent used.'),
  authorName: z.string().nullable(),
  via: z
    .enum(['user', 'token', 'oauth_client'])
    .describe('How it was written: by a person in the admin, a personal token, or an app.'),
  client: z
    .string()
    .nullable()
    .describe('The MCP client that wrote it, as it named itself, and its model when it said.'),
  title: z.string().nullable().describe('The title of its frontmatter, when it has one.'),
  wordCount: z.number().int(),
  errors: z.number().int().describe('How many errors the contracts reported when it was saved.'),
  warnings: z.number().int(),
  head: z.boolean().describe('Whether it is the latest revision of the entry.'),
  live: z.boolean().describe('Whether it is the revision the site shows now.'),
  published: z.boolean().describe('Whether it was ever published.'),
})

/** A comment on a review (v0.6), by a person or by the agent of one. */
export const reviewComment = z.object({
  id: z.string(),
  author: z.string().describe('The user who wrote it, or whose token their agent used.'),
  authorName: z.string().nullable(),
  client: z
    .string()
    .nullable()
    .describe('The name the client gave, such as hollware-agents for the agents; null for none.'),
  body: z.string(),
  at: z.string(),
})

export const conflict = z.object({
  currentVersion: z.number().int().min(1),
  headRevision: revisionId,
})

export const format = z.enum(['markdown', 'document', 'html'])

/** How a search is made: by its words, by meaning, or both merged (ADR-030). */
export const searchMode = z.enum(['fulltext', 'semantic', 'hybrid'])

export const componentDescription = z.object({
  name: z.string(),
  description: z.string().nullable(),
  example: z.string().nullable(),
  props: z.record(z.string(), z.unknown()).describe('The JSON Schema of the props.'),
})

export const contractDescription = z.object({
  id: z.string(),
  severity,
  phases: z.array(phase),
  description: z.string(),
})

export const collectionDescription = z.object({
  name: z.string(),
  schema: z.record(z.string(), z.unknown()).describe('The JSON Schema of the frontmatter.'),
  routes: z.record(z.string(), z.string()).describe('The public path of an entry, per locale.'),
  translationGroupField: z
    .string()
    .nullable()
    .describe('The frontmatter field that the translations of an entry share, or null.'),
  tagsField: z.string().nullable().describe('The frontmatter field with the tags, or null.'),
  sortByField: z
    .string()
    .nullable()
    .describe(
      'The frontmatter field, a date, that orders published listings, newest first; null when they follow the date of first publication.',
    ),
  components: z.array(componentDescription),
  contracts: z.array(contractDescription),
  maxMarkdownBytes: z.number().int(),
  styleGuide: z.string().nullable(),
})

export const siteDescription = z.object({
  key: z.string(),
  locales: z.array(z.string()),
  defaultLocale: z.string(),
  url: z
    .string()
    .nullable()
    .describe('The public origin of the site, which starts the URL of each entry, or null.'),
  styleGuide: z.string().nullable(),
  collections: z.array(collectionDescription),
})
