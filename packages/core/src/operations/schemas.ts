import { AUTOMATIC_KINDS } from '../config/automatic.ts'
import * as z from 'zod'

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
  code: z
    .string()
    .optional()
    .describe('Which problem of its contract this is, when the contract finds more than one kind.'),
  params: z
    .record(z.string(), z.union([z.string(), z.number()]))
    .optional()
    .describe('The values the message names, for a client that says it in another language.'),
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
        alt: z
          .string()
          .optional()
          .describe(
            'What the image shows, as it was uploaded; absent from a Hollware before 1.0.0-rc.5.',
          ),
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

export const document = z.object({
  nodes: z.array(z.unknown()),
  frontmatter: z.record(z.string(), z.unknown()),
  meta: z.record(z.string(), z.unknown()),
})

export const entry = entrySummary.extend({
  revision: revisionId.describe('The revision this view shows.'),
  automatic: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "The values of the fields Hollware fills (the collection's automaticFields) for this revision, as a site reads them in its frontmatter. Absent when the collection names none.",
    ),
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

export const reviewComment = z.object({
  id: z.string(),
  author: z.string().describe('The user who wrote it, or whose token their agent used.'),
  authorName: z.string().nullable(),
  authorKind: z
    .enum(['person', 'agent'])
    .describe('Whether a person wrote it, or an agent member of the site.'),
  client: z
    .string()
    .nullable()
    .describe('The name the client gave, such as hollware-agents for the agents; null for none.'),
  body: z.string(),
  at: z.string(),
  entryId: entryId
    .nullable()
    .describe('The entry of the review the comment is about, or null for the whole review.'),
  lines: z
    .object({ from: z.number().int().min(1), to: z.number().int().min(1) })
    .nullable()
    .describe('The lines of the proposed Markdown of that entry it is about, or null.'),
})

export const reviewAgent = z.object({
  name: z.string().describe('The agent, as the site declares it.'),
  status: z
    .enum(['queued', 'commented', 'failed'])
    .describe(
      'queued until it comments on the review, commented once it did, failed when its delivery was given up.',
    ),
  required: z.boolean().describe('Whether approve_review waits for its comment, as the site asks.'),
})

export const reviewAction = z
  .enum(['publish', 'unpublish'])
  .describe('What approving the review does to the entry.')

export const conflict = z.object({
  currentVersion: z.number().int().min(1),
  headRevision: revisionId,
})

export const format = z.enum(['markdown', 'document', 'html'])

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
  automaticFields: z
    .record(z.string(), z.enum(AUTOMATIC_KINDS))
    .optional()
    .describe(
      'The fields Hollware fills itself, by name, and how: firstPublished, lastModified, readingTime or wordCount. Do not write them: a site reads them filled.',
    ),
  components: z.array(componentDescription),
  contracts: z.array(contractDescription),
  maxMarkdownBytes: z.number().int(),
  styleGuide: z.string().nullable(),
  navigation: z
    .object({
      groupBy: z.string().nullable(),
      groups: z.array(z.string()).nullable(),
      orderBy: z.string().nullable(),
    })
    .optional()
    .describe(
      'How getNavigation arranges the published entries: the field that groups them, the groups in their order, and the number field that orders each group before the title. Absent when they are listed by title.',
    ),
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
