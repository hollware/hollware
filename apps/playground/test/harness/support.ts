import { generatePersonalToken, hashPersonalToken, makePreviewToken, newId } from '@hollware/core'
import type { TestHarness } from 'wrangler'
import { HARNESS_SECRET, HOLLWARE_URL, HOLLWARE_WORKER } from './workers.ts'

/** The site of the playground: its key in hollware.config.ts. */
export const SITE_KEY = 'playground'

export const ALL_SCOPES = ['content:read', 'content:write', 'content:publish', 'schema:admin']

/** The part of a D1 binding the seed uses. The binding a test gets is a proxy to the Worker's own. */
interface Statement {
  bind(...values: unknown[]): Statement
}

interface Database {
  prepare(sql: string): Statement
  batch(statements: Statement[]): Promise<unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Applies the migrations that wrangler.jsonc points at to the D1 of the built Hollware Worker. */
export async function migrate(server: TestHarness): Promise<void> {
  await server.getWorker(HOLLWARE_WORKER).applyD1Migrations('DB')
}

/**
 * What `hollware init` does, so that an agent can come in: the site, its owner and a personal
 * token. This is the one thing a test writes behind the Worker's back, because a token is how an
 * agent gets in; everything else is created through MCP. Returns the token in clear.
 */
export async function seedOwnerToken(
  server: TestHarness,
  scopes: readonly string[] = ALL_SCOPES,
  site: string = SITE_KEY,
): Promise<string> {
  const env = await server.getWorker<{ DB: Database }>(HOLLWARE_WORKER).getEnv()
  const now = new Date().toISOString()
  const userId = newId('usr')
  const token = generatePersonalToken()
  await env.DB.batch([
    env.DB.prepare('INSERT INTO sites (id, created_at, updated_at) VALUES (?1, ?2, ?2)').bind(
      site,
      now,
    ),
    env.DB.prepare(
      "INSERT INTO users (id, name, role, created_at, updated_at) VALUES (?1, 'Owner', 'owner', ?2, ?2)",
    ).bind(userId, now),
    env.DB.prepare(
      "INSERT INTO members (id, site_id, user_id, role, created_at, updated_at) VALUES (?1, ?2, ?3, 'owner', ?4, ?4)",
    ).bind(newId('mbr'), site, userId, now),
    env.DB.prepare(
      `INSERT INTO tokens (id, site_id, user_id, label, hash, scopes, created_at, updated_at)
          VALUES (?1, ?2, ?3, 'harness', ?4, ?5, ?6, ?6)`,
    ).bind(newId('tok'), site, userId, await hashPersonalToken(token), JSON.stringify(scopes), now),
  ])
  return token
}

/** What a tool answers: `isError` as the operation says, and its output, or `{ code, message, fix }`. */
export interface ToolAnswer {
  readonly isError: boolean
  readonly output: Record<string, unknown>
}

/**
 * An agent's MCP client, in the wire format of the 2026-07-28 era: one `tools/call` per request,
 * with the personal token in `Authorization`, sent to Hollware at its public URL. It is what
 * every test uses to create content, so that content gets in the way an agent's does.
 */
export function agentWith(server: TestHarness, token: string) {
  return {
    async call(tool: string, args: Record<string, unknown>): Promise<ToolAnswer> {
      const response = await server.fetch(`${HOLLWARE_URL}/mcp`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2026-07-28',
          'mcp-method': 'tools/call',
          'mcp-name': tool,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: tool,
            arguments: args,
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientInfo': { name: 'harness-agent', version: '0.0.0' },
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        }),
      })
      const message: unknown = await response.json()
      const result = isRecord(message) ? message['result'] : undefined
      if (response.status !== 200 || !isRecord(result)) {
        throw new Error(`${tool} was not answered: ${response.status} ${JSON.stringify(message)}`)
      }
      const structured = result['structuredContent']
      const content = result['content']
      const text = Array.isArray(content) && isRecord(content[0]) ? content[0]['text'] : undefined
      const output: unknown = isRecord(structured)
        ? structured
        : typeof text === 'string'
          ? JSON.parse(text)
          : undefined
      if (!isRecord(output))
        throw new Error(`${tool} answered no output: ${JSON.stringify(result)}`)
      return { isError: result['isError'] === true, output }
    },
  }
}

export type Agent = ReturnType<typeof agentWith>

/** One Markdown file to create as an entry. */
export interface Draft {
  /** The collection; the blog unless it says otherwise. */
  readonly collection?: string
  readonly locale: 'es' | 'en'
  readonly slug: string
  readonly markdown: string
}

function entryOf(answer: ToolAnswer): { id: string; version: number } {
  const { entry } = answer.output
  if (!isRecord(entry) || typeof entry['id'] !== 'string' || typeof entry['version'] !== 'number') {
    throw new Error(`the answer has no entry: ${JSON.stringify(answer.output)}`)
  }
  return { id: entry['id'], version: entry['version'] }
}

/** Creates an entry as a draft, as an agent does, and returns its id and version. */
export async function createDraft(agent: Agent, draft: Draft) {
  const answer = await agent.call('create_draft', { collection: 'blog', ...draft })
  if (answer.output['outcome'] !== 'saved') {
    throw new Error(`${draft.locale}/${draft.slug} was not saved: ${JSON.stringify(answer.output)}`)
  }
  return entryOf(answer)
}

/** The warnings of a `needs_acknowledgement` answer, as `publish` takes them back. */
function warningsOf(answer: ToolAnswer): { contract: unknown; path: unknown }[] {
  const { verdict } = answer.output
  const warnings = isRecord(verdict) ? verdict['warnings'] : undefined
  if (!Array.isArray(warnings)) {
    throw new Error(`the answer lists no warnings: ${JSON.stringify(answer.output)}`)
  }
  return warnings.map((warning: unknown) => ({
    contract: isRecord(warning) ? warning['contract'] : undefined,
    path: isRecord(warning) ? warning['path'] : undefined,
  }))
}

/**
 * Creates an entry and publishes it, and returns its id. When publish asks to acknowledge
 * warnings, this acknowledges them: these tests are about what a site reads, and the playground's
 * contracts warn about a missing translation and a link to an entry that is not published yet.
 * The acceptance suite (tests/acceptance) holds the contracts themselves.
 */
export async function publishNew(agent: Agent, draft: Draft): Promise<string> {
  const { id, version } = await createDraft(agent, draft)
  let answer = await agent.call('publish', { id, version })
  if (answer.output['outcome'] === 'needs_acknowledgement') {
    answer = await agent.call('publish', { id, version, acknowledgeWarnings: warningsOf(answer) })
  }
  if (answer.output['outcome'] !== 'published') {
    throw new Error(
      `${draft.locale}/${draft.slug} was not published: ${JSON.stringify(answer.output)}`,
    )
  }
  return id
}

/**
 * A preview token for an entry, made as the admin's route makes one, with the secret of the
 * harness's Hollware. `secret` and `ageSeconds` make a forged and an expired one: a token that
 * is `ageSeconds` old has lived that many seconds of its hour.
 */
export async function previewTokenFor(
  entryId: string,
  options: { readonly secret?: string; readonly ageSeconds?: number } = {},
): Promise<string> {
  const { token } = await makePreviewToken({
    secret: options.secret ?? HARNESS_SECRET,
    site: SITE_KEY,
    entryId,
    now: new Date(Date.now() - (options.ageSeconds ?? 0) * 1000),
  })
  return token
}
