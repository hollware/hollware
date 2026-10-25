import {
  contracts,
  approveReview as approveReviewSpec,
  commentReview as commentReviewSpec,
  connectAnalytics as connectAnalyticsSpec,
  contentStats as contentStatsSpec,
  disconnectAnalytics as disconnectAnalyticsSpec,
  getAnalytics as getAnalyticsSpec,
  createDraft as createDraftSpec,
  deleteEntry as deleteEntrySpec,
  defineCollection,
  defineComponent,
  defineConfig,
  describeSite as describeSiteSpec,
  getEntry as getEntrySpec,
  getRevision as getRevisionSpec,
  getTranslations as getTranslationsSpec,
  listEntries as listEntriesSpec,
  listRedirects as listRedirectsSpec,
  listReviews as listReviewsSpec,
  listRevisions as listRevisionsSpec,
  moveEntry as moveEntrySpec,
  processMarkdown,
  publish as publishSpec,
  requestChanges as requestChangesSpec,
  rejectReview as rejectReviewSpec,
  requestReview as requestReviewSpec,
  restoreEntry as restoreEntrySpec,
  restoreRevision as restoreRevisionSpec,
  scheduleUnpublish as scheduleUnpublishSpec,
  search as searchSpec,
  renderHtml,
  resolveConfig,
  unpublish as unpublishSpec,
  updateDraft as updateDraftSpec,
  validate as validateSpec,
  type ResolvedSite,
  type Scope,
} from '@hollware/core'
import * as z from 'zod'
import type { Principal } from '../../src/auth/types.ts'
import { handlers } from '../../src/ops/index.ts'
import type { OperationContext } from '../../src/ops/types.ts'
import type { Clock, ContentStore, View } from '../../src/ports.ts'
import { seedOwner, siteKey } from '../db/support.ts'

export const NO_ENTRY = 'ent_01JAB3XQ8ZK4M6N2P5R7S9T0VW'

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const blog = defineCollection({
  schema: z.object({
    title: z.string().min(1),
    seoTitle: z.string().min(1).max(60).optional(),
    description: z.string().min(1).max(160),
    date: z.iso.date(),
    tags: z.array(z.string().min(1)).min(1),
    translationGroup: z.string().regex(SLUG),
  }),
  routes: { es: '/blog/:slug/', en: '/en/blog/:slug/' },
  translations: { groupBy: 'translationGroup' },
  tags: 'tags',
  sortBy: 'date',
  components: {
    callout: defineComponent({
      props: z.strictObject({ type: z.enum(['info', 'warning', 'tip']) }),
      description: 'A highlighted note in the flow of the text.',
      example: '::callout{type="tip"}\nKeep the slug short.\n::',
    }),
    youtube: defineComponent({
      props: z.strictObject({ id: z.string().regex(/^[\w-]{11}$/) }),
      description: 'A YouTube video, by its id.',
      example: '::youtube{id="dQw4w9WgXcQ"}\n::',
    }),
  },
  contracts: [
    contracts.translationPair(),
    contracts.internalLinksResolve(),
    contracts.imagesHaveAlt(),
    {
      id: 'seo-title-length',
      severity: 'warning',
      description: 'A title of at most 60 characters, or a seoTitle, which search engines show.',
      check: ({ frontmatter }) =>
        frontmatter.title.length <= 60 || frontmatter.seoTitle !== undefined
          ? []
          : [
              {
                path: '/frontmatter/title',
                message: `The title has ${frontmatter.title.length} characters; search engines show about 60.`,
                fix: 'Shorten the title to 60 characters or fewer, or add a seoTitle of at most 60.',
              },
            ],
    },
  ],
  styleGuide: 'Short paragraphs, one idea per section, and an example for every claim.',
})

function notesWith(maxMarkdownBytes: number) {
  return defineCollection({
    schema: z.looseObject({ title: z.string().min(1) }),
    routes: { es: '/notas/:slug/', en: '/en/notes/:slug/' },
    contracts: [
      {
        id: 'entry-id',
        severity: 'warning',
        description: 'Reports the id of the entry it was run for, when the frontmatter says probe.',
        check: ({ entryId, frontmatter }) =>
          frontmatter['probe'] === true
            ? [
                {
                  path: '',
                  message: `Run for the entry ${entryId}.`,
                  fix: 'Nothing: this contract only reports what it was given.',
                },
              ]
            : [],
      },
      {
        id: 'many-warnings',
        severity: 'warning',
        phases: ['publish'],
        description: 'Reports as many warnings as the frontmatter asks for in flood.',
        check: ({ frontmatter }) => {
          const flood = frontmatter['flood']
          return typeof flood === 'number'
            ? Array.from({ length: flood }, (_, index) => ({
                path: '/frontmatter/flood',
                message: `Warning ${index + 1} of ${flood}, which only says that it is one of many.`,
                fix: 'Nothing: this contract only makes warnings.',
              }))
            : []
        },
      },
    ],
    maxMarkdownBytes,
  })
}

export function blogSite(
  key: string,
  options: { readonly notesMaxBytes?: number } = {},
): ResolvedSite {
  const config = resolveConfig(
    defineConfig({
      sites: {
        [key]: {
          locales: ['es', 'en'],
          defaultLocale: 'es',
          collections: { blog, notes: notesWith(options.notesMaxBytes ?? 768 * 1024) },
        },
      },
    }),
  )
  const site = config.sites.get(key)
  if (site === undefined) throw new Error(`resolveConfig lost the site ${key}`)
  return site
}

export interface Tenant {
  readonly key: string
  readonly site: ResolvedSite
  readonly userId: string
  readonly tokenId: string
}

export async function newTenant(db: D1Database, label: string): Promise<Tenant> {
  const owner = await seedOwner(db, siteKey(label))
  return tenantOf(owner.site, owner.actor.userId, owner.actor.tokenId)
}

export function tenantOf(key: string, userId: string, tokenId: string | null): Tenant {
  if (tokenId === null) throw new Error(`the site ${key} has no token to write with`)
  return { key, site: blogSite(key), userId, tokenId }
}

export const ALL_SCOPES: readonly Scope[] = [
  'content:read',
  'content:write',
  'content:publish',
  'schema:admin',
]

export interface ContextOptions {
  readonly clock: Clock
  readonly view?: View
  readonly principal?: Principal
  readonly client?: Readonly<Record<string, unknown>> | null
  readonly requestId?: string
}

export function contextFor(
  tenant: Tenant,
  store: ContentStore,
  options: ContextOptions,
): OperationContext {
  return {
    site: tenant.site,
    principal: options.principal ?? {
      kind: 'token',
      userId: tenant.userId,
      tokenId: tenant.tokenId,
      site: tenant.key,
      scopes: ALL_SCOPES,
    },
    view: options.view ?? 'head',
    store,
    clock: options.clock,
    client: options.client ?? null,
    requestId: options.requestId ?? 'req_test_1',
  }
}

export const BINDING: Principal = { kind: 'binding', scopes: ['content:read'] }

type SpecOf<Input extends z.ZodType, Output extends z.ZodType> = {
  readonly name: string
  readonly input: Input
  readonly output: Output
}

async function call<Input extends z.ZodType, Output extends z.ZodType>(
  spec: SpecOf<Input, Output>,
  handler: (input: z.output<Input>, context: OperationContext) => Promise<z.output<Output>>,
  raw: z.input<Input>,
  context: OperationContext,
): Promise<z.output<Output>> {
  const answer = await handler(spec.input.parse(raw), context)
  const checked = spec.output.safeParse(answer)
  if (!checked.success) {
    throw new Error(
      `${spec.name} answered what its output schema refuses: ${JSON.stringify(checked.error.issues)}`,
    )
  }
  return answer
}

export function agent(context: OperationContext) {
  return {
    approveReview: (input: z.input<typeof approveReviewSpec.input>) =>
      call(approveReviewSpec, handlers.approve_review, input, context),
    listReviews: (input: z.input<typeof listReviewsSpec.input> = {}) =>
      call(listReviewsSpec, handlers.list_reviews, input, context),
    requestChanges: (input: z.input<typeof requestChangesSpec.input>) =>
      call(requestChangesSpec, handlers.request_changes, input, context),
    rejectReview: (input: z.input<typeof rejectReviewSpec.input>) =>
      call(rejectReviewSpec, handlers.reject_review, input, context),
    commentReview: (input: z.input<typeof commentReviewSpec.input>) =>
      call(commentReviewSpec, handlers.comment_review, input, context),
    contentStats: (input: z.input<typeof contentStatsSpec.input>) =>
      call(contentStatsSpec, handlers.content_stats, input, context),
    getAnalytics: () => call(getAnalyticsSpec, handlers.get_analytics, {}, context),
    connectAnalytics: (input: z.input<typeof connectAnalyticsSpec.input>) =>
      call(connectAnalyticsSpec, handlers.connect_analytics, input, context),
    disconnectAnalytics: () =>
      call(disconnectAnalyticsSpec, handlers.disconnect_analytics, {}, context),
    createDraft: (input: z.input<typeof createDraftSpec.input>) =>
      call(createDraftSpec, handlers.create_draft, input, context),
    deleteEntry: (input: z.input<typeof deleteEntrySpec.input>) =>
      call(deleteEntrySpec, handlers.delete_entry, input, context),
    restoreEntry: (input: z.input<typeof restoreEntrySpec.input>) =>
      call(restoreEntrySpec, handlers.restore_entry, input, context),
    listRevisions: (input: z.input<typeof listRevisionsSpec.input>) =>
      call(listRevisionsSpec, handlers.list_revisions, input, context),
    getRevision: (input: z.input<typeof getRevisionSpec.input>) =>
      call(getRevisionSpec, handlers.get_revision, input, context),
    restoreRevision: (input: z.input<typeof restoreRevisionSpec.input>) =>
      call(restoreRevisionSpec, handlers.restore_revision, input, context),
    scheduleUnpublish: (input: z.input<typeof scheduleUnpublishSpec.input>) =>
      call(scheduleUnpublishSpec, handlers.schedule_unpublish, input, context),
    moveEntry: (input: z.input<typeof moveEntrySpec.input>) =>
      call(moveEntrySpec, handlers.move_entry, input, context),
    listRedirects: (input: z.input<typeof listRedirectsSpec.input> = {}) =>
      call(listRedirectsSpec, handlers.list_redirects, input, context),
    describeSite: () => call(describeSiteSpec, handlers.describe_site, {}, context),
    getEntry: (input: z.input<typeof getEntrySpec.input>) =>
      call(getEntrySpec, handlers.get_entry, input, context),
    getTranslations: (input: z.input<typeof getTranslationsSpec.input>) =>
      call(getTranslationsSpec, handlers.get_translations, input, context),
    listEntries: (input: z.input<typeof listEntriesSpec.input>) =>
      call(listEntriesSpec, handlers.list_entries, input, context),
    publish: (input: z.input<typeof publishSpec.input>) =>
      call(publishSpec, handlers.publish, input, context),
    requestReview: (input: z.input<typeof requestReviewSpec.input>) =>
      call(requestReviewSpec, handlers.request_review, input, context),
    search: (input: z.input<typeof searchSpec.input>) =>
      call(searchSpec, handlers.search, input, context),
    unpublish: (input: z.input<typeof unpublishSpec.input>) =>
      call(unpublishSpec, handlers.unpublish, input, context),
    updateDraft: (input: z.input<typeof updateDraftSpec.input>) =>
      call(updateDraftSpec, handlers.update_draft, input, context),
    validate: (input: z.input<typeof validateSpec.input>) =>
      call(validateSpec, handlers.validate, input, context),
  }
}

export async function warmUpComark(): Promise<void> {
  await processMarkdown('warm up', { components: [], maxMarkdownBytes: 1024, routes: {} })
  await renderHtml({ frontmatter: {}, meta: {}, nodes: [] })
}

export function blogFrontmatter(overrides: Readonly<Record<string, string | null>> = {}): string {
  const fields: Record<string, string | null> = {
    title: 'Edge caching guide',
    description: 'How to cache at the edge.',
    date: '2026-10-01',
    tags: '\n  - cloudflare\n  - cms',
    translationGroup: 'edge-caching-guide',
    ...overrides,
  }
  const lines = Object.entries(fields).flatMap(([key, value]) =>
    value === null ? [] : [value.startsWith('\n') ? `${key}:${value}` : `${key}: ${value}`],
  )
  return `---\n${lines.join('\n')}\n---\n`
}

export function blogPost(
  overrides: Readonly<Record<string, string | null>> = {},
  body = '\n# Edge caching guide\n\nWhat an edge cache keeps.\n',
): string {
  return `${blogFrontmatter(overrides)}${body}`
}

function touched(method: string): never {
  throw new Error(`the store was touched: ${method}`)
}

export const UNTOUCHED: ContentStore = {
  findEntry: () => touched('findEntry'),
  findEntryById: () => touched('findEntryById'),
  listEntries: () => touched('listEntries'),
  searchEntries: () => touched('searchEntries'),
  findSummaries: () => touched('findSummaries'),
  relatedOf: () => touched('relatedOf'),
  listTranslations: () => touched('listTranslations'),
  lookup: () => touched('lookup'),
  lastPublication: () => touched('lastPublication'),
  listRevisions: () => touched('listRevisions'),
  findRevision: () => touched('findRevision'),
  moveEntry: () => touched('moveEntry'),
  listRedirects: () => touched('listRedirects'),
  sourceHeadTimes: () => touched('sourceHeadTimes'),
  revisionTimes: () => touched('revisionTimes'),
  scheduleUnpublish: () => touched('scheduleUnpublish'),
  cancelUnpublish: () => touched('cancelUnpublish'),
  unpublishOf: () => touched('unpublishOf'),
  dueUnpublishes: () => touched('dueUnpublishes'),
  createEntry: () => touched('createEntry'),
  appendRevision: () => touched('appendRevision'),
  publish: () => touched('publish'),
  publishGroup: () => touched('publishGroup'),
  schedule: () => touched('schedule'),
  dueSchedules: () => touched('dueSchedules'),
  cancelSchedule: () => touched('cancelSchedule'),
  unpublish: () => touched('unpublish'),
  trashEntry: () => touched('trashEntry'),
  restoreEntry: () => touched('restoreEntry'),
  requestReview: () => touched('requestReview'),
  findReview: () => touched('findReview'),
  listReviews: () => touched('listReviews'),
  requestChanges: () => touched('requestChanges'),
  rejectReview: () => touched('rejectReview'),
  commentReview: () => touched('commentReview'),
  reviewComments: () => touched('reviewComments'),
}
