import {
  siteDefinitionData,
  type OperationByName,
  type OperationName,
  type OutcomeOf,
  type ResolvedSite,
  type schemas,
  type Scope,
} from '@hollware/core'
import {
  Client,
  StreamableHTTPClientTransport,
  type ClientCapabilities,
} from '@modelcontextprotocol/client'
import type * as z from 'zod'
import type { Principal } from '../../src/auth/types.ts'
import {
  createMcpEndpoint,
  type McpCall,
  type McpEndpoint,
  type McpLogEntry,
} from '../../src/mcp/index.ts'
import type { Handlers, OperationContext, OperationHandler } from '../../src/ops/types.ts'
import type { Clock, ContentStore } from '../../src/ports.ts'

/**
 * What the tests of the MCP endpoint stand on: a call as the gateway would make it, fake
 * handlers that record what they get and answer with a canned output for each outcome, and two
 * ways to talk to the endpoint in process: the SDK client in either protocol era, and raw
 * JSON-RPC. The handlers are fakes because the real ones belong to another work package.
 */

export const ENTRY_ID = 'ent_01JAB3XQ8ZK4M6N2P5R7S9T0VW'
const REVISION_ID = 'rev_01JAB3XQ8ZK4M6N2P5R7S9T0VX'

export const SITE: ResolvedSite = {
  key: 'playground',
  locales: ['en', 'es'],
  defaultLocale: 'en',
  styleGuide: null,
  collections: new Map(),
  url: null,
  cors: { origins: [] },
  events: { webhooks: [], indexNow: null },
  audit: { ipAddresses: 'off', retentionDays: null },
}

const unused = (): never => {
  throw new Error('a fake handler never reaches the store')
}

/** A store that no test touches: the fake handlers do not call it, but the context carries one. */
export const STORE: ContentStore = {
  findEntry: unused,
  findEntryById: unused,
  listEntries: unused,
  searchEntries: unused,
  findSummaries: unused,
  relatedOf: unused,
  listTranslations: unused,
  lookup: unused,
  lastPublication: unused,
  createEntry: unused,
  appendRevision: unused,
  publish: unused,
  publishGroup: unused,
  schedule: unused,
  dueSchedules: unused,
  cancelSchedule: unused,
  unpublish: unused,
  trashEntry: unused,
  restoreEntry: unused,
  requestReview: unused,
  findReview: unused,
  listReviews: unused,
  requestChanges: unused,
  commentReview: unused,
  reviewComments: unused,
}

export const CLOCK: Clock = { now: () => new Date('2026-10-12T12:00:00.000Z') }

export const ALL_SCOPES: readonly Scope[] = [
  'content:read',
  'content:write',
  'content:publish',
  'schema:admin',
]

export function tokenPrincipal(scopes: readonly Scope[] = ALL_SCOPES): Principal {
  return {
    kind: 'token',
    userId: 'usr_01JAB3XQ8ZK4M6N2P5R7S9T0VA',
    tokenId: 'tok_01JAB3XQ8ZK4M6N2P5R7S9T0VB',
    site: 'playground',
    scopes,
  }
}

/** A call as the gateway makes it for one request. */
export function makeCall(overrides: { principal?: Principal; requestId?: string } = {}): McpCall {
  return {
    principal: overrides.principal ?? tokenPrincipal(),
    requestId: overrides.requestId ?? 'req_test_1',
    context: { site: SITE, store: STORE, clock: CLOCK },
  }
}

// ---- canned outputs ------------------------------------------------------------------------

type Verdict = z.output<typeof schemas.verdict>
type Violation = z.output<typeof schemas.violation>
type EntrySummary = z.output<typeof schemas.entrySummary>
type Entry = z.output<typeof schemas.entry>

const VERDICT_OK: Verdict = {
  ok: true,
  phase: 'write',
  errors: [],
  warnings: [],
  contractsHash: 'hash-1',
}

const ERROR: Violation = {
  contract: 'required-description',
  severity: 'error',
  path: '/frontmatter/description',
  message: 'The description is missing.',
  fix: 'Add a description of at most 160 characters.',
}

const VERDICT_FAILED: Verdict = { ...VERDICT_OK, ok: false, errors: [ERROR] }

export const WARNING_TITLE: Violation = {
  contract: 'seo-title-length',
  severity: 'warning',
  path: '/frontmatter/title',
  message: 'The title has 72 characters.',
  fix: 'Shorten it to 60 characters or fewer.',
}

export const WARNING_ALT: Violation = {
  contract: 'image-alt',
  severity: 'warning',
  path: '/body',
  message: 'An image has no alternative text.',
  fix: 'Describe the image between the brackets.',
  line: 12,
}

export const VERDICT_WARNED: Verdict = {
  ok: true,
  phase: 'publish',
  errors: [],
  warnings: [WARNING_TITLE, WARNING_ALT],
  contractsHash: 'hash-1',
}

export const SUMMARY: EntrySummary = {
  id: ENTRY_ID,
  collection: 'blog',
  locale: 'en',
  slug: 'hello-world',
  translationGroup: 'hello',
  status: 'draft',
  version: 1,
  frontmatter: { title: 'Hello world' },
  tags: ['news'],
  hasUnpublishedChanges: false,
  publishedAt: null,
  scheduledAt: null,
  deletedAt: null,
  updatedAt: '2026-10-12T12:00:00.000Z',
}

export const ENTRY: Entry = {
  ...SUMMARY,
  revision: REVISION_ID,
  verdict: VERDICT_OK,
  lastPublication: null,
  markdown: '---\ntitle: Hello world\n---\nHello.',
}

const CONFLICT = { currentVersion: 2, headRevision: REVISION_ID }

export const REVIEW_ID = 'rvw_01JAB3XQ8ZK4M6N2P5R7S9T0VX'

const REVIEW = {
  id: REVIEW_ID,
  entryId: ENTRY_ID,
  revision: REVISION_ID,
  status: 'pending',
  requestedBy: 'usr_01JAB3XQ8ZK4M6N2P5R7S9T0VA',
  requestedByName: 'Ada',
  requestedAt: '2026-10-12T12:00:00.000Z',
  decidedBy: null,
  decidedAt: null,
  note: null,
} as const

type OutputOf<Name extends OperationName> = z.output<OperationByName<Name>['output']>

type Canned = {
  readonly [Name in OperationName]: Readonly<
    Record<OutcomeOf<OperationByName<Name>['output']>, OutputOf<Name>>
  >
}

/** A site's definition as get_structure answers it: every default filled in. */
const STRUCTURE = siteDefinitionData.parse({
  locales: ['en'],
  defaultLocale: 'en',
  collections: {
    blog: {
      schema: { type: 'object', properties: { title: { type: 'string' } } },
      routes: { en: '/blog/:slug/' },
    },
  },
})

const PROBLEM = {
  path: 'sites.acme.collections.blog.schema',
  message: 'the schema of the frontmatter is not of an object',
  fix: 'Give a JSON Schema with "type": "object" and the fields under "properties".',
}

const STRUCTURE_CHANGES: Canned['update_site'] = {
  updated: { outcome: 'updated', version: 3 },
  unchanged: { outcome: 'unchanged', version: 2 },
  invalid: { outcome: 'invalid', problems: [PROBLEM] },
  needs_confirmation: {
    outcome: 'needs_confirmation',
    impact: { removedCollections: [{ name: 'blog', entries: 3 }], removedLocales: [], refused: [] },
  },
  conflict: { outcome: 'conflict', currentVersion: 4 },
}

/** A valid output for every outcome of every operation. */
export const CANNED: Canned = {
  approve_review: {
    published: {
      outcome: 'published',
      review: { ...REVIEW, status: 'approved' },
      entry: { ...SUMMARY, status: 'published', version: 2 },
    },
    blocked: { outcome: 'blocked', review: REVIEW, entry: SUMMARY, verdict: VERDICT_FAILED },
    needs_acknowledgement: {
      outcome: 'needs_acknowledgement',
      review: REVIEW,
      entry: SUMMARY,
      verdict: VERDICT_WARNED,
    },
    not_pending: { outcome: 'not_pending', review: { ...REVIEW, status: 'cancelled' } },
    not_found: { outcome: 'not_found' },
  },
  create_draft: {
    saved: { outcome: 'saved', entry: SUMMARY, verdict: VERDICT_OK },
    refused: { outcome: 'refused', verdict: VERDICT_FAILED },
    in_trash: {
      outcome: 'in_trash',
      entry: { ...SUMMARY, version: 2, deletedAt: '2026-10-12T12:00:00.000Z' },
    },
  },
  describe_site: {
    ok: {
      outcome: 'ok',
      site: {
        key: 'playground',
        locales: ['en', 'es'],
        defaultLocale: 'en',
        url: null,
        styleGuide: null,
        collections: [],
      },
    },
  },
  comment_review: {
    commented: {
      outcome: 'commented',
      comment: {
        id: 'rvc_01JAB3XQ8ZK4M6N2P5R7S9T0VZ',
        author: 'usr_01JAB3XQ8ZK4M6N2P5R7S9T0VA',
        authorName: 'Ada',
        client: null,
        body: 'Add an example.',
        at: '2026-10-13T11:00:00.000Z',
      },
    },
    not_pending: { outcome: 'not_pending' },
    not_found: { outcome: 'not_found' },
  },
  content_stats: {
    ok: {
      outcome: 'ok',
      since: '2026-09-15T10:00:00.000Z',
      pages: [
        { path: '/blog/hello-world/', views: 42, entry: SUMMARY },
        { path: '/', views: 7, entry: null },
      ],
    },
    unavailable: { outcome: 'unavailable' },
  },
  get_entry: {
    ok: { outcome: 'ok', entry: ENTRY },
    not_found: { outcome: 'not_found' },
  },
  get_translations: {
    ok: { outcome: 'ok', entries: [SUMMARY] },
    not_found: { outcome: 'not_found' },
  },
  list_entries: {
    ok: { outcome: 'ok', entries: [SUMMARY], nextCursor: null },
  },
  search: {
    ok: {
      outcome: 'ok',
      mode: 'fulltext',
      results: [{ entry: SUMMARY, snippet: 'the [words] found', score: 1.5 }],
    },
  },
  list_reviews: {
    ok: {
      outcome: 'ok',
      reviews: [
        {
          ...REVIEW,
          entry: SUMMARY,
          comments: [
            {
              id: 'rvc_01JAB3XQ8ZK4M6N2P5R7S9T0VZ',
              author: 'usr_01JAB3XQ8ZK4M6N2P5R7S9T0VA',
              authorName: 'Ada',
              client: 'hollware-agents',
              body: 'The second section needs an example.',
              at: '2026-10-13T11:00:00.000Z',
            },
          ],
        },
      ],
    },
  },
  publish: {
    published: { outcome: 'published', entry: { ...SUMMARY, status: 'published', version: 2 } },
    scheduled: { outcome: 'scheduled', entry: { ...SUMMARY, status: 'scheduled', version: 2 } },
    blocked: { outcome: 'blocked', entry: SUMMARY, verdict: VERDICT_FAILED },
    needs_acknowledgement: {
      outcome: 'needs_acknowledgement',
      entry: SUMMARY,
      verdict: VERDICT_WARNED,
    },
    pending_review: {
      outcome: 'pending_review',
      entry: SUMMARY,
      verdict: VERDICT_OK,
      review: REVIEW,
    },
    conflict: { outcome: 'conflict', conflict: CONFLICT },
    not_found: { outcome: 'not_found' },
  },
  request_review: {
    pending_review: {
      outcome: 'pending_review',
      entry: SUMMARY,
      verdict: VERDICT_OK,
      review: REVIEW,
    },
    blocked: { outcome: 'blocked', entry: SUMMARY, verdict: VERDICT_FAILED },
    needs_acknowledgement: {
      outcome: 'needs_acknowledgement',
      entry: SUMMARY,
      verdict: VERDICT_OK,
    },
    conflict: { outcome: 'conflict', conflict: { currentVersion: 2, headRevision: REVISION_ID } },
    not_found: { outcome: 'not_found' },
  },
  request_changes: {
    changes_requested: {
      outcome: 'changes_requested',
      review: { ...REVIEW, status: 'changes_requested', note: 'Cite a source.' },
    },
    not_pending: { outcome: 'not_pending', review: { ...REVIEW, status: 'approved' } },
    not_found: { outcome: 'not_found' },
  },
  unpublish: {
    unpublished: { outcome: 'unpublished', entry: SUMMARY },
    not_found: { outcome: 'not_found' },
  },
  update_draft: {
    saved: { outcome: 'saved', entry: { ...SUMMARY, version: 2 }, verdict: VERDICT_OK },
    unchanged: { outcome: 'unchanged', entry: SUMMARY },
    conflict: { outcome: 'conflict', conflict: CONFLICT },
    not_found: { outcome: 'not_found' },
    refused: { outcome: 'refused', verdict: VERDICT_FAILED },
  },
  validate: {
    ok: { outcome: 'ok', verdict: VERDICT_OK },
  },
  create_site: {
    created: { outcome: 'created', version: 1 },
    taken: { outcome: 'taken' },
    invalid: { outcome: 'invalid', problems: [PROBLEM] },
  },
  delete_entry: {
    trashed: {
      outcome: 'trashed',
      entry: { ...SUMMARY, version: 2, deletedAt: '2026-10-12T12:00:00.000Z' },
    },
    published: { outcome: 'published', entry: { ...SUMMARY, status: 'published', version: 2 } },
    conflict: { outcome: 'conflict', conflict: { currentVersion: 2, headRevision: REVISION_ID } },
    not_found: { outcome: 'not_found' },
  },
  restore_entry: {
    restored: { outcome: 'restored', entry: { ...SUMMARY, version: 3 } },
    not_trashed: { outcome: 'not_trashed', entry: SUMMARY },
    not_found: { outcome: 'not_found' },
  },
  delete_site: {
    trashed: { outcome: 'trashed' },
    needs_confirmation: { outcome: 'needs_confirmation', entries: 3 },
    not_found: { outcome: 'not_found' },
  },
  make_webhook_secret: {
    made: { outcome: 'made', secret: `whsec_${'a'.repeat(64)}` },
    not_found: { outcome: 'not_found' },
    unavailable: { outcome: 'unavailable' },
  },
  get_structure: {
    ok: { outcome: 'ok', site: 'acme', version: 2, definition: STRUCTURE, catalog: [] },
  },
  restore_site: {
    restored: { outcome: 'restored' },
    not_found: { outcome: 'not_found' },
  },
  set_collection: STRUCTURE_CHANGES,
  update_site: STRUCTURE_CHANGES,
}

/** The canned output of one outcome, or undefined for an outcome the operation does not have. */
export function cannedOutput(tool: OperationName, outcome: string): unknown {
  return Object.entries(CANNED[tool]).find(([name]) => name === outcome)?.[1]
}

const MARKDOWN = '---\ntitle: Hello world\n---\nHello.'

/** A valid input for every operation. */
export const INPUTS: { readonly [Name in OperationName]: z.input<OperationByName<Name>['input']> } =
  {
    approve_review: { id: REVIEW_ID },
    comment_review: { id: REVIEW_ID, body: 'Add an example.' },
    content_stats: {},
    create_draft: { collection: 'blog', locale: 'en', slug: 'hello-world', markdown: MARKDOWN },
    describe_site: {},
    get_entry: { collection: 'blog', locale: 'en', slug: 'hello-world' },
    get_translations: { collection: 'blog', translationGroup: 'hello' },
    list_entries: { collection: 'blog' },
    search: { query: 'words' },
    list_reviews: {},
    publish: { id: ENTRY_ID, version: 1 },
    request_changes: { id: REVIEW_ID, note: 'Cite a source.' },
    request_review: { id: ENTRY_ID, version: 1 },
    unpublish: { id: ENTRY_ID },
    update_draft: { id: ENTRY_ID, version: 1, markdown: MARKDOWN },
    validate: { collection: 'blog', locale: 'en', slug: 'hello-world', markdown: MARKDOWN },
    create_site: { key: 'notes', definition: STRUCTURE },
    delete_site: { key: 'notes' },
    delete_entry: { id: ENTRY_ID, version: 1 },
    restore_entry: { id: ENTRY_ID },
    get_structure: {},
    make_webhook_secret: { webhook: 'newsletter' },
    restore_site: { key: 'notes' },
    set_collection: { version: 2, name: 'blog', collection: null },
    update_site: { version: 2, definition: STRUCTURE },
  }

// ---- fake handlers -------------------------------------------------------------------------

/** What a fake handler was called with. */
export interface Seen {
  readonly tool: OperationName
  readonly input: unknown
  readonly context: OperationContext
}

export type Overrides = { [Name in OperationName]?: Handlers[Name] }

/** The canned output of an outcome, for a handler that answers it. */
function pick<Output>(canned: Readonly<Record<string, Output>>, outcome: string): Output {
  const found = Object.entries(canned).find(([name]) => name === outcome)
  if (found === undefined) throw new Error(`no canned output for the outcome ${outcome}`)
  return found[1]
}

/**
 * One handler for every operation. Each records its call and answers with a canned output: the
 * one of the outcome the test names for the operation, or else of its first outcome. A test that
 * needs another behavior gives the handler of the operation itself.
 */
export function fakeHandlers(
  overrides: Overrides = {},
  outcomes: { readonly [Name in OperationName]?: string } = {},
): { handlers: Handlers; seen: Seen[] } {
  const seen: Seen[] = []
  const record =
    <Name extends OperationName>(
      tool: Name,
      handler: OperationHandler<Name>,
    ): OperationHandler<Name> =>
    async (input, context) => {
      seen.push({ tool, input, context })
      return handler(input, context)
    }
  const handlers: Handlers = {
    approve_review: record(
      'approve_review',
      overrides.approve_review ??
        (async () => pick(CANNED.approve_review, outcomes.approve_review ?? 'published')),
    ),
    comment_review: record(
      'comment_review',
      overrides.comment_review ??
        (async () => pick(CANNED.comment_review, outcomes.comment_review ?? 'commented')),
    ),
    content_stats: record(
      'content_stats',
      overrides.content_stats ??
        (async () => pick(CANNED.content_stats, outcomes.content_stats ?? 'ok')),
    ),
    create_draft: record(
      'create_draft',
      overrides.create_draft ??
        (async () => pick(CANNED.create_draft, outcomes.create_draft ?? 'saved')),
    ),
    describe_site: record(
      'describe_site',
      overrides.describe_site ??
        (async () => pick(CANNED.describe_site, outcomes.describe_site ?? 'ok')),
    ),
    get_entry: record(
      'get_entry',
      overrides.get_entry ?? (async () => pick(CANNED.get_entry, outcomes.get_entry ?? 'ok')),
    ),
    get_translations: record(
      'get_translations',
      overrides.get_translations ??
        (async () => pick(CANNED.get_translations, outcomes.get_translations ?? 'ok')),
    ),
    list_entries: record(
      'list_entries',
      overrides.list_entries ??
        (async () => pick(CANNED.list_entries, outcomes.list_entries ?? 'ok')),
    ),
    search: record(
      'search',
      overrides.search ?? (async () => pick(CANNED.search, outcomes.search ?? 'ok')),
    ),
    list_reviews: record(
      'list_reviews',
      overrides.list_reviews ??
        (async () => pick(CANNED.list_reviews, outcomes.list_reviews ?? 'ok')),
    ),
    request_review: record(
      'request_review',
      overrides.request_review ??
        (async () => pick(CANNED.request_review, outcomes.request_review ?? 'pending_review')),
    ),
    request_changes: record(
      'request_changes',
      overrides.request_changes ??
        (async () => pick(CANNED.request_changes, outcomes.request_changes ?? 'changes_requested')),
    ),
    publish: record(
      'publish',
      overrides.publish ?? (async () => pick(CANNED.publish, outcomes.publish ?? 'published')),
    ),
    unpublish: record(
      'unpublish',
      overrides.unpublish ??
        (async () => pick(CANNED.unpublish, outcomes.unpublish ?? 'unpublished')),
    ),
    update_draft: record(
      'update_draft',
      overrides.update_draft ??
        (async () => pick(CANNED.update_draft, outcomes.update_draft ?? 'saved')),
    ),
    validate: record(
      'validate',
      overrides.validate ?? (async () => pick(CANNED.validate, outcomes.validate ?? 'ok')),
    ),
    create_site: record(
      'create_site',
      overrides.create_site ??
        (async () => pick(CANNED.create_site, outcomes.create_site ?? 'created')),
    ),
    delete_entry: record(
      'delete_entry',
      overrides.delete_entry ??
        (async () => pick(CANNED.delete_entry, outcomes.delete_entry ?? 'trashed')),
    ),
    restore_entry: record(
      'restore_entry',
      overrides.restore_entry ??
        (async () => pick(CANNED.restore_entry, outcomes.restore_entry ?? 'restored')),
    ),
    delete_site: record(
      'delete_site',
      overrides.delete_site ??
        (async () => pick(CANNED.delete_site, outcomes.delete_site ?? 'trashed')),
    ),
    make_webhook_secret: record(
      'make_webhook_secret',
      overrides.make_webhook_secret ??
        (async () => pick(CANNED.make_webhook_secret, outcomes.make_webhook_secret ?? 'made')),
    ),
    get_structure: record(
      'get_structure',
      overrides.get_structure ??
        (async () => pick(CANNED.get_structure, outcomes.get_structure ?? 'ok')),
    ),
    restore_site: record(
      'restore_site',
      overrides.restore_site ??
        (async () => pick(CANNED.restore_site, outcomes.restore_site ?? 'restored')),
    ),
    set_collection: record(
      'set_collection',
      overrides.set_collection ??
        (async () => pick(CANNED.set_collection, outcomes.set_collection ?? 'updated')),
    ),
    update_site: record(
      'update_site',
      overrides.update_site ??
        (async () => pick(CANNED.update_site, outcomes.update_site ?? 'updated')),
    ),
  }
  return { handlers, seen }
}

/** An endpoint over fake handlers, with the handler calls and the log lines it wrote. */
export function endpointWith(
  overrides: Overrides = {},
  options: {
    timeoutMs?: number
    log?: (entry: McpLogEntry) => void
    outcomes?: { readonly [Name in OperationName]?: string }
  } = {},
) {
  const { handlers, seen } = fakeHandlers(overrides, options.outcomes)
  const logs: McpLogEntry[] = []
  const endpoint = createMcpEndpoint({
    handlers,
    serverInfo: { name: 'hollware', version: '0.0.0' },
    log: options.log ?? ((entry) => void logs.push(entry)),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  })
  return { endpoint, seen, logs }
}

// ---- the SDK client, in process ------------------------------------------------------------

/** One HTTP exchange between the client and the endpoint. */
export interface Exchange {
  readonly method: string
  readonly body: { readonly method?: string; readonly params?: unknown } | null
  readonly status: number
  readonly headers: Record<string, string>
  readonly text: string
}

export interface ConnectOptions {
  /** 2026 is a client that discovers and sends a `_meta` envelope; 2025 one that initializes. */
  readonly era: '2026' | '2025'
  readonly principal?: Principal
  /** The capabilities the client declares. */
  readonly capabilities?: ClientCapabilities
  /** Answers the questions of the server. Without it the client has no elicitation handler. */
  readonly elicit?: (message: string) => {
    action: 'accept' | 'decline' | 'cancel'
    content?: Record<string, boolean>
  }
}

/** An SDK client that talks to the endpoint without a network, and what went over the wire. */
export async function connect(endpoint: McpEndpoint, options: ConnectOptions) {
  const exchanges: Exchange[] = []
  let requests = 0
  const client = new Client(
    { name: 'probe', version: '9.9.9' },
    {
      ...(options.capabilities === undefined ? {} : { capabilities: options.capabilities }),
      ...(options.era === '2026' ? { versionNegotiation: { mode: { pin: '2026-07-28' } } } : {}),
    },
  )
  if (options.elicit !== undefined) {
    const answer = options.elicit
    client.setRequestHandler('elicitation/create', (request) => answer(request.params.message))
  }
  await client.connect(
    new StreamableHTTPClientTransport(new URL('https://hollware.test/mcp'), {
      fetch: async (input, init) => {
        requests += 1
        const request = new Request(input, init)
        const sent = request.method === 'POST' ? await request.clone().text() : ''
        const response = await endpoint.fetch(
          request,
          makeCall({
            requestId: `req_client_${requests}`,
            ...(options.principal === undefined ? {} : { principal: options.principal }),
          }),
        )
        exchanges.push({
          method: request.method,
          body: sent === '' ? null : JSON.parse(sent),
          status: response.status,
          headers: Object.fromEntries(response.headers),
          text: await response.clone().text(),
        })
        return response
      },
    }),
  )
  return { client, exchanges }
}

// ---- raw JSON-RPC --------------------------------------------------------------------------

export interface RawOptions {
  readonly call?: McpCall
  readonly headers?: Record<string, string>
  /** What a 2026 client declares in its envelope. */
  readonly capabilities?: Record<string, unknown>
  readonly clientInfo?: Record<string, unknown>
  /** `inputResponses` and `requestState` of a retry. */
  readonly inputResponses?: Record<string, unknown>
  readonly requestState?: string
}

export interface Raw {
  readonly status: number
  readonly headers: Headers
  readonly text: string
  /** The JSON-RPC message: the body, or the `data:` of the event of a 2025 answer. */
  readonly message: Record<string, unknown>
  /** `result` of the message, when it is an object. */
  readonly result: Record<string, unknown>
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {}
}

/** One JSON-RPC request, in the wire format of an era, without the SDK client. */
export async function rpc(
  endpoint: McpEndpoint,
  era: 'modern' | 'legacy',
  method: string,
  params: Record<string, unknown> = {},
  options: RawOptions = {},
): Promise<Raw> {
  const modern = era === 'modern'
  const body = {
    jsonrpc: '2.0',
    id: 1,
    method,
    params: {
      ...params,
      ...(options.inputResponses === undefined ? {} : { inputResponses: options.inputResponses }),
      ...(options.requestState === undefined ? {} : { requestState: options.requestState }),
      ...(modern
        ? {
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientInfo': options.clientInfo ?? {
                name: 'raw-client',
                version: '0.0.0',
              },
              'io.modelcontextprotocol/clientCapabilities': options.capabilities ?? {},
            },
          }
        : {}),
    },
  }
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': modern ? '2026-07-28' : '2025-11-25',
    ...(modern ? { 'mcp-method': method } : {}),
    ...(modern && typeof params.name === 'string' ? { 'mcp-name': params.name } : {}),
    ...options.headers,
  }
  const response = await endpoint.fetch(
    new Request('https://hollware.test/mcp', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
    options.call ?? makeCall(),
  )
  const text = await response.text()
  const json = response.headers.get('content-type')?.startsWith('text/event-stream')
    ? text
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => line.slice('data: '.length))
        .join('')
    : text
  const message = asRecord(JSON.parse(json))
  return {
    status: response.status,
    headers: response.headers,
    text,
    message,
    result: asRecord(message.result),
  }
}

/** `tools/call` in raw JSON-RPC. */
export function callRaw(
  endpoint: McpEndpoint,
  era: 'modern' | 'legacy',
  tool: OperationName,
  args: unknown,
  options: RawOptions = {},
): Promise<Raw> {
  return rpc(endpoint, era, 'tools/call', { name: tool, arguments: args }, options)
}

/** The text block of a result, parsed. */
export function textOf(result: Record<string, unknown>): unknown {
  const content = result.content
  if (!Array.isArray(content)) throw new Error('the result has no content')
  const first = asRecord(content[0])
  if (typeof first.text !== 'string') throw new Error('the first block is not text')
  return JSON.parse(first.text)
}
