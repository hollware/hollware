import {
  createDraft,
  getEntry,
  OPERATIONS,
  publish,
  updateDraft,
  validate,
  type Scope,
} from '@hollware/core'
import {
  createMcpHandler,
  McpServer,
  type CallToolResult,
  type RegisteredTool,
} from '@modelcontextprotocol/server'
import { Buffer } from 'node:buffer'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

/**
 * A stand-in for a running Hollware, for the tests of `import`: an MCP server built with
 * `@modelcontextprotocol/server`, served over HTTP on a random local port, whose five tools
 * (`get_entry`, `create_draft`, `update_draft`, `validate`, `publish`) keep state and use the
 * input and output schemas of the real operation specs. It stands in for the Worker of
 * `packages/server`, which this package does not own, and it follows what the specs and the
 * plan say: a draft is saved at version 1, an update at the version read saves a new
 * revision or answers `unchanged` for the same Markdown, a stale version is a `conflict`,
 * every change of an entry (a publish too) bumps its version, and a publish is `blocked` by
 * errors and needs the acknowledgement of warnings.
 *
 * Like the real server, it answers 401 to a missing or wrong bearer token, and 403 with an
 * `insufficient_scope` challenge naming the scopes a tool needs when the token lacks them.
 */

export const STUB_TIME = '2026-10-12T12:00:00.000Z'

/** Put this anywhere in a file and the stub reports a `comark-parse` violation. */
export const COMARK_BREAK = '<<comark-break>>'

export interface StubViolation {
  contract: string
  severity: 'error' | 'warning'
  path: string
  message: string
  fix: string
}

export interface StubFile {
  collection: string
  locale: string
  slug: string
  markdown: string
}

export interface StubEntry {
  id: string
  collection: string
  locale: string
  slug: string
  version: number
  /** The Markdown of every revision, oldest first. */
  revisions: string[]
  /** The index of the published revision, or `null`. */
  published: number | null
}

export interface RecordedCall {
  tool: string
  /** The arguments exactly as the CLI sent them. */
  args: Record<string, unknown>
}

export interface StubOptions {
  /** The bearer token the stub accepts. */
  token: string
  /** The scopes of that token. Every scope when absent. */
  scopes?: readonly Scope[]
  /** The UTF-8 bytes beyond which a file is refused with `size-limit`. */
  maxBytes?: number
  /** Other errors and warnings of a file: the contract errors that are saved with a draft. */
  findings?: (file: StubFile) => { errors?: StubViolation[]; warnings?: StubViolation[] }
  /** Tools the server does not have: a call to one is answered with a protocol error. */
  without?: readonly string[]
  /** Answers a tool call with words only, as a tool that fails does: `isError` and no outcome. */
  toolError?: (call: RecordedCall) => string | undefined
  /** Runs before a tool call is handled, to change the state the way another writer would. */
  before?: (call: RecordedCall, entries: Map<string, StubEntry>) => void
  /** Answers a request itself instead of the stub, to play a server that misbehaves. */
  respond?: (request: Request) => Response | undefined
}

export interface StubServer {
  /** `http://127.0.0.1:<port>`: the address to give `--url`. */
  url: string
  entries: Map<string, StubEntry>
  /** Every tool call, in order. */
  calls: RecordedCall[]
  /** The `Authorization` header of every HTTP request, in order. */
  authorizations: (string | null)[]
  close: () => Promise<void>
}

const BOM = String.fromCharCode(0xfeff)
const FRONTMATTER = new RegExp(`^${BOM}?---\\r?\\n[\\s\\S]*?\\r?\\n---`)
const REFUSALS = ['size-limit', 'frontmatter-syntax', 'comark-parse']

function violation(contract: string, path: string, message: string, fix: string): StubViolation {
  return { contract, severity: 'error', path, message, fix }
}

function revisionId(entry: StubEntry): string {
  return `rev_${String(entry.revisions.length).padStart(26, '0')}`
}

export function startStub(options: StubOptions): Promise<StubServer> {
  const entries = new Map<string, StubEntry>()
  const calls: RecordedCall[] = []
  const authorizations: (string | null)[] = []
  const granted = options.scopes ?? [
    'content:read',
    'content:write',
    'content:publish',
    'schema:admin',
  ]
  let nextId = 0

  const key = (file: Pick<StubFile, 'collection' | 'locale' | 'slug'>): string =>
    `${file.collection}/${file.locale}/${file.slug}`

  function violationsOf(file: StubFile): { errors: StubViolation[]; warnings: StubViolation[] } {
    const errors: StubViolation[] = []
    if (Buffer.byteLength(file.markdown) > (options.maxBytes ?? 8192)) {
      errors.push(
        violation(
          'size-limit',
          '/body',
          'The file is larger than the collection allows.',
          'Split it into several entries.',
        ),
      )
    }
    if (!FRONTMATTER.test(file.markdown)) {
      errors.push(
        violation(
          'frontmatter-syntax',
          '/frontmatter',
          'The frontmatter does not parse.',
          'Start the file with a YAML block between two --- lines.',
        ),
      )
    }
    if (file.markdown.includes(COMARK_BREAK)) {
      errors.push(
        violation('comark-parse', '/body', 'The body does not parse.', `Remove ${COMARK_BREAK}.`),
      )
    }
    const extra = options.findings?.(file) ?? {}
    return { errors: [...errors, ...(extra.errors ?? [])], warnings: extra.warnings ?? [] }
  }

  function verdictOf(file: StubFile, phase: 'write' | 'publish') {
    const { errors, warnings } = violationsOf(file)
    return { ok: errors.length === 0, phase, errors, warnings, contractsHash: 'stub' }
  }

  function summaryOf(entry: StubEntry) {
    return {
      id: entry.id,
      collection: entry.collection,
      locale: entry.locale,
      slug: entry.slug,
      translationGroup: null,
      status: entry.published === null ? ('draft' as const) : ('published' as const),
      version: entry.version,
      frontmatter: {},
      tags: [],
      hasUnpublishedChanges: entry.published !== entry.revisions.length - 1,
      publishedAt: entry.published === null ? null : STUB_TIME,
      scheduledAt: null,
      deletedAt: null,
      updatedAt: STUB_TIME,
    }
  }

  function fileOf(entry: StubEntry, markdown: string): StubFile {
    return { collection: entry.collection, locale: entry.locale, slug: entry.slug, markdown }
  }

  function byId(id: string): StubEntry | undefined {
    return [...entries.values()].find((entry) => entry.id === id)
  }

  const reply = (
    outcomes: Record<string, { isError: boolean }>,
    output: { outcome: string; [field: string]: unknown },
  ): CallToolResult => ({
    content: [{ type: 'text', text: JSON.stringify(output) }],
    structuredContent: output,
    ...(outcomes[output.outcome]?.isError === true ? { isError: true } : {}),
  })

  /** Records the call, lets the test fail it or change the state, then runs the handler. */
  const guarded =
    <Args extends Record<string, unknown>>(tool: string, handler: (args: Args) => CallToolResult) =>
    (args: Args): CallToolResult => {
      const call: RecordedCall = { tool, args }
      calls.push(call)
      const failure = options.toolError?.(call)
      if (failure !== undefined) {
        return { content: [{ type: 'text', text: failure }], isError: true }
      }
      options.before?.(call, entries)
      return handler(args)
    }

  function buildServer(): McpServer {
    const server = new McpServer({ name: 'stub-hollware', version: '0.0.0' })
    const keep = (name: string, tool: RegisteredTool): void => {
      if (options.without?.includes(name) === true) tool.remove()
    }
    const describe = (spec: { title: string; description: string }) => ({
      title: spec.title,
      description: spec.description,
    })

    keep(
      getEntry.name,
      server.registerTool(
        getEntry.name,
        { ...describe(getEntry), inputSchema: getEntry.input, outputSchema: getEntry.output },
        guarded(getEntry.name, (args) => {
          const entry = entries.get(key(args))
          if (entry === undefined) return reply(getEntry.outcomes, { outcome: 'not_found' })
          const markdown = entry.revisions.at(-1) ?? ''
          return reply(getEntry.outcomes, {
            outcome: 'ok',
            entry: {
              ...summaryOf(entry),
              revision: revisionId(entry),
              verdict: verdictOf(fileOf(entry, markdown), 'write'),
              lastPublication: null,
              markdown,
            },
          })
        }),
      ),
    )

    keep(
      createDraft.name,
      server.registerTool(
        createDraft.name,
        {
          ...describe(createDraft),
          inputSchema: createDraft.input,
          outputSchema: createDraft.output,
        },
        guarded(createDraft.name, (args) => {
          const verdict = verdictOf(args, 'write')
          if (verdict.errors.some((found) => REFUSALS.includes(found.contract))) {
            return reply(createDraft.outcomes, { outcome: 'refused', verdict })
          }
          if (entries.has(key(args))) {
            const taken = violation(
              'slug-taken',
              '/slug',
              'The slug is taken.',
              'Choose another slug.',
            )
            return reply(createDraft.outcomes, {
              outcome: 'refused',
              verdict: { ...verdict, ok: false, errors: [taken] },
            })
          }
          nextId += 1
          const entry: StubEntry = {
            id: `ent_${String(nextId).padStart(26, '0')}`,
            collection: args.collection,
            locale: args.locale,
            slug: args.slug,
            version: 1,
            revisions: [args.markdown],
            published: null,
          }
          entries.set(key(args), entry)
          return reply(createDraft.outcomes, { outcome: 'saved', entry: summaryOf(entry), verdict })
        }),
      ),
    )

    keep(
      updateDraft.name,
      server.registerTool(
        updateDraft.name,
        {
          ...describe(updateDraft),
          inputSchema: updateDraft.input,
          outputSchema: updateDraft.output,
        },
        guarded(updateDraft.name, (args) => {
          const entry = byId(args.id)
          if (entry === undefined) return reply(updateDraft.outcomes, { outcome: 'not_found' })
          if (entry.version !== args.version) {
            return reply(updateDraft.outcomes, {
              outcome: 'conflict',
              conflict: { currentVersion: entry.version, headRevision: revisionId(entry) },
            })
          }
          const verdict = verdictOf(fileOf(entry, args.markdown), 'write')
          if (verdict.errors.some((found) => REFUSALS.includes(found.contract))) {
            return reply(updateDraft.outcomes, { outcome: 'refused', verdict })
          }
          if (entry.revisions.at(-1) === args.markdown) {
            return reply(updateDraft.outcomes, {
              outcome: 'unchanged',
              entry: summaryOf(entry),
              verdict,
            })
          }
          entry.revisions.push(args.markdown)
          entry.version += 1
          return reply(updateDraft.outcomes, { outcome: 'saved', entry: summaryOf(entry), verdict })
        }),
      ),
    )

    keep(
      validate.name,
      server.registerTool(
        validate.name,
        { ...describe(validate), inputSchema: validate.input, outputSchema: validate.output },
        guarded(validate.name, (args) =>
          reply(validate.outcomes, { outcome: 'ok', verdict: verdictOf(args, 'publish') }),
        ),
      ),
    )

    keep(
      publish.name,
      server.registerTool(
        publish.name,
        { ...describe(publish), inputSchema: publish.input, outputSchema: publish.output },
        guarded(publish.name, (args) => {
          // Like Hollware: without content:publish, one entry is asked for review, now, and a
          // group or a time is refused (v0.3).
          const reviewOnly = !granted.includes('content:publish')
          if (reviewOnly && (args.group.length > 0 || args.publishAt !== undefined)) {
            return {
              content: [
                {
                  type: 'text',
                  text: 'Without content:publish, publish asks for a review of one entry, now: not of a group, and not at a time.',
                },
              ],
              isError: true,
            }
          }
          // Like Hollware: the entry and its group, all or none, and the member that stops the
          // group named in failedEntry when there is a group.
          const members = [{ id: args.id, version: args.version }, ...args.group]
          const named = args.group.length > 0
          const checked = []
          for (const member of members) {
            const failedEntry = named ? { failedEntry: member.id } : {}
            const entry = byId(member.id)
            if (entry === undefined) {
              return reply(publish.outcomes, { outcome: 'not_found', ...failedEntry })
            }
            if (entry.version !== member.version) {
              return reply(publish.outcomes, {
                outcome: 'conflict',
                conflict: { currentVersion: entry.version, headRevision: revisionId(entry) },
                ...failedEntry,
              })
            }
            const verdict = verdictOf(fileOf(entry, entry.revisions.at(-1) ?? ''), 'publish')
            if (verdict.errors.length > 0) {
              return reply(publish.outcomes, {
                outcome: 'blocked',
                entry: summaryOf(entry),
                verdict,
                ...failedEntry,
              })
            }
            checked.push({ entry, verdict, failedEntry })
          }
          for (const { entry, verdict, failedEntry } of checked) {
            const unacknowledged = verdict.warnings.filter(
              (warning) =>
                !args.acknowledgeWarnings.some(
                  (ack) => ack.contract === warning.contract && ack.path === warning.path,
                ),
            )
            if (unacknowledged.length > 0) {
              return reply(publish.outcomes, {
                outcome: 'needs_acknowledgement',
                entry: summaryOf(entry),
                verdict,
                ...failedEntry,
              })
            }
          }
          const [asked] = checked
          if (reviewOnly && asked !== undefined) {
            return reply(publish.outcomes, {
              outcome: 'pending_review',
              entry: summaryOf(asked.entry),
              verdict: asked.verdict,
              review: {
                id: 'rvw_01JAB3XQ8ZK4M6N2P5R7S9T0VX',
                entryId: asked.entry.id,
                revision: revisionId(asked.entry),
                status: 'pending',
                requestedBy: 'usr_01JAB3XQ8ZK4M6N2P5R7S9T0VA',
                requestedByName: null,
                requestedAt: STUB_TIME,
                decidedBy: null,
                decidedAt: null,
                note: null,
              },
            })
          }
          for (const { entry } of checked) {
            entry.published = entry.revisions.length - 1
            entry.version += 1
          }
          const [first] = checked
          if (first === undefined) throw new Error('a publish without an entry')
          return reply(publish.outcomes, {
            outcome: 'published',
            entry: summaryOf(first.entry),
            verdict: first.verdict,
          })
        }),
      ),
    )
    return server
  }

  const handler = createMcpHandler(() => buildServer())

  async function handle(request: Request): Promise<Response> {
    authorizations.push(request.headers.get('authorization'))
    const custom = options.respond?.(request)
    if (custom !== undefined) return custom
    if (request.headers.get('authorization') !== `Bearer ${options.token}`) {
      return new Response(JSON.stringify({ error: 'invalid_token' }), {
        status: 401,
        headers: {
          'content-type': 'application/json',
          'www-authenticate': 'Bearer realm="hollware"',
        },
      })
    }
    const missing = (await scopesNeeded(request)).filter((scope) => !granted.includes(scope))
    if (missing.length > 0) {
      return new Response(JSON.stringify({ error: 'insufficient_scope' }), {
        status: 403,
        headers: {
          'content-type': 'application/json',
          'www-authenticate': `Bearer error="insufficient_scope", scope="${missing.join(' ')}"`,
        },
      })
    }
    return handler.fetch(request)
  }

  const http = createServer((incoming, outgoing) => {
    void forward(incoming, outgoing)
  })

  async function forward(incoming: IncomingMessage, outgoing: ServerResponse): Promise<void> {
    const chunks: Buffer[] = []
    for await (const chunk of incoming) chunks.push(Buffer.from(chunk))
    const method = incoming.method ?? 'GET'
    const headers = new Headers()
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (typeof value === 'string') headers.set(name, value)
    }
    const request = new Request(`http://${incoming.headers.host}${incoming.url ?? '/'}`, {
      method,
      headers,
      ...(method === 'GET' || method === 'HEAD' ? {} : { body: Buffer.concat(chunks) }),
    })
    const response = await handle(request)
    outgoing.writeHead(response.status, Object.fromEntries(response.headers))
    if (response.body !== null) {
      for await (const chunk of response.body) outgoing.write(chunk)
    }
    outgoing.end()
  }

  return new Promise((resolve) => {
    http.listen(0, '127.0.0.1', () => {
      const address = http.address()
      if (address === null || typeof address === 'string') throw new Error('the stub has no port')
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        entries,
        calls,
        authorizations,
        close: async () => {
          await handler.close()
          http.closeAllConnections()
          await new Promise<void>((done) => http.close(() => done()))
        },
      })
    })
  })
}

/** The scopes the tool of a `tools/call` request needs, from the operation specs. */
async function scopesNeeded(request: Request): Promise<readonly Scope[]> {
  if (request.method !== 'POST') return []
  try {
    const body: unknown = await request.clone().json()
    if (typeof body !== 'object' || body === null || !('method' in body)) return []
    if (body.method !== 'tools/call') return []
    const params = 'params' in body ? body.params : undefined
    const name =
      typeof params === 'object' && params !== null && 'name' in params ? params.name : undefined
    return OPERATIONS.find((spec) => spec.name === name)?.scopes ?? []
  } catch {
    return []
  }
}
