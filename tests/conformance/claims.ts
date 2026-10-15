import { request } from 'node:http'
import type { CheckResult } from './results.ts'

/**
 * What the conformance suite cannot see of Hollware, probed directly at the Worker. The suite
 * reaches the Worker through the proxy, which gives every request the token of the owner, so it
 * never meets a 401 or a 403 for a missing scope. And its DNS rebinding scenario sends a foreign
 * Host and a foreign Origin together, so it goes red only when both checks of the Worker are gone,
 * never when one is. These probes send the requests the suite does not:
 *
 * - a foreign Host alone, and a foreign Origin alone, are refused with 403, and the public Host is
 *   accepted (so a Worker that refuses everything does not pass);
 * - a request without a token, and one with a token nobody issued, are 401 with their challenge;
 * - a token without the scope of a tool is 403 with the challenge that names the scope, and a token
 *   with it is served (so a Worker that refuses every call does not pass).
 *
 * The answers are the ones that `packages/server` documents and tests: `auth/responses.ts` for the
 * challenges and `mcp/scopes.ts` for the scope challenge, as the SDK words it. The probes are the
 * scenario `hollware-claims` of the results, in the shape of a scenario of the suite, so that the
 * must-pass profile names their checks like any other.
 */

export const CLAIMS_SCENARIO = 'hollware-claims'

/** A check of the scenario: the fields of `checks.json` that the runner reads, and their texts. */
export interface ProbeResult extends CheckResult {
  readonly name: string
  readonly description: string
}

/** The protocol era of the requests that reach a tool: 2026-07-28 is modern, 2025-11-25 legacy. */
export type Era = 'modern' | 'legacy'

export interface ClaimsOptions {
  /** The port of `wrangler dev`: the probes go to the Worker, not through the proxy. */
  readonly workerPort: number
  /** The `HOLLWARE_PUBLIC_URL` of the Worker, the only Host and Origin it answers. */
  readonly publicUrl: string
  readonly era: Era
  /** A personal token with `content:read` and nothing else. */
  readonly readOnlyToken: string
  /** How long each request may wait for its answer, in milliseconds. 10 s when absent. */
  readonly timeoutMs?: number
}

interface Answer {
  readonly status: number | undefined
  readonly headers: Readonly<Record<string, string | string[] | undefined>>
  readonly text: string
}

function exchange(
  port: number,
  timeoutMs: number,
  options: { method: string; path: string; headers: readonly string[]; body?: string },
): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const call = request(
      {
        host: '127.0.0.1',
        port,
        method: options.method,
        path: options.path,
        headers: [...options.headers],
      },
      (answer) => {
        const chunks: Buffer[] = []
        answer.on('data', (chunk: Buffer) => chunks.push(chunk))
        answer.on('end', () => {
          resolve({
            status: answer.statusCode,
            headers: answer.headers,
            text: Buffer.concat(chunks).toString('utf8'),
          })
        })
      },
    )
    call.setTimeout(timeoutMs, () => {
      call.destroy(new Error(`no answer within ${timeoutMs} ms`))
    })
    call.once('error', reject)
    call.end(options.body)
  })
}

/**
 * The JSON of an answer, whether the Worker sent it as JSON or as a server-sent event. An answer
 * that is not JSON throws, and the probe fails with what the parser said.
 */
function messageOf(answer: Answer): unknown {
  const type = answer.headers['content-type']
  const json =
    typeof type === 'string' && type.startsWith('text/event-stream')
      ? answer.text
          .split('\n')
          .filter((line) => line.startsWith('data: '))
          .map((line) => line.slice('data: '.length))
          .join('')
      : answer.text
  return JSON.parse(json)
}

function header(answer: Answer, name: string): string | undefined {
  const value = answer.headers[name]
  return typeof value === 'string' ? value : undefined
}

function codeOf(answer: Answer): unknown {
  const message = messageOf(answer)
  return typeof message === 'object' && message !== null && 'code' in message
    ? message.code
    : undefined
}

/** A `tools/call` as a client of the era sends it, with the headers the era requires. */
function toolCall(era: Era, tool: string, args: Record<string, unknown>) {
  const modern = era === 'modern'
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: tool,
      arguments: args,
      ...(modern
        ? {
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientInfo': {
                name: 'conformance-claims',
                version: '0.0.0',
              },
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          }
        : {}),
    },
  })
  const headers = [
    'content-type',
    'application/json',
    'accept',
    'application/json, text/event-stream',
    'mcp-protocol-version',
    modern ? '2026-07-28' : '2025-11-25',
    ...(modern ? ['mcp-method', 'tools/call', 'mcp-name', tool] : []),
  ]
  return { headers, body }
}

/** A draft that is valid for the collection of `worker/hollware.config.ts`. */
const DRAFT = {
  collection: 'notes',
  locale: 'en',
  slug: 'claims-probe',
  markdown:
    '---\ntitle: Claims probe\n---\n\nA draft that a token without content:write must not make.\n',
}

/** A token of the right shape that no one was issued. */
const UNKNOWN_TOKEN = 'hw_pat_zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz'

const FOREIGN = 'evil.example.com'

/** The result of one probe: it passes without a problem, and a failed one says what the Worker answered. */
function verdict(id: string, description: string, problems: string[]): ProbeResult {
  return {
    id,
    name: id,
    description,
    status: problems.length === 0 ? 'SUCCESS' : 'FAILURE',
    errorMessage: problems.length === 0 ? undefined : problems.join('; '),
  }
}

function expectStatus(answer: Answer, status: number, problems: string[]): void {
  if (answer.status !== status) problems.push(`expected ${status}, got ${answer.status}`)
}

/** Where the challenges of `/mcp` send a client to learn how to get a token (RFC 9728, ADR-026). */
function metadataOf(publicUrl: URL): string {
  return `${publicUrl.origin}/.well-known/oauth-protected-resource/mcp`
}

function expectHeader(answer: Answer, name: string, expected: string, problems: string[]): void {
  const found = header(answer, name)
  if (found !== expected) problems.push(`expected ${name}: ${expected}, got ${found ?? 'none'}`)
}

export async function probeClaims(options: ClaimsOptions): Promise<ProbeResult[]> {
  const publicUrl = new URL(options.publicUrl)
  const timeoutMs = options.timeoutMs ?? 10_000
  const mcp = (headers: readonly string[], body: string) =>
    exchange(options.workerPort, timeoutMs, { method: 'POST', path: '/mcp', headers, body })
  const health = (headers: readonly string[]) =>
    exchange(options.workerPort, timeoutMs, { method: 'GET', path: '/health', headers })
  const results: ProbeResult[] = []
  const probe = async (
    id: string,
    description: string,
    run: (problems: string[]) => Promise<void>,
  ): Promise<void> => {
    const problems: string[] = []
    try {
      await run(problems)
    } catch (error) {
      problems.push(`the request failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    results.push(verdict(id, description, problems))
  }

  await probe(
    'public-host-is-accepted',
    'A request to the public URL of the Worker is served',
    async (problems) => {
      expectStatus(await health(['host', publicUrl.host]), 200, problems)
    },
  )
  await probe(
    'host-check-rejects-a-foreign-host',
    'A request with a foreign Host and no Origin is refused with 403 forbidden_host',
    async (problems) => {
      const answer = await health(['host', FOREIGN])
      expectStatus(answer, 403, problems)
      if (codeOf(answer) !== 'forbidden_host')
        problems.push(`expected code forbidden_host, got ${String(codeOf(answer))}`)
    },
  )
  await probe(
    'origin-check-rejects-a-foreign-origin',
    'A request to the public Host with a foreign Origin is refused with 403 forbidden_origin',
    async (problems) => {
      const answer = await health(['host', publicUrl.host, 'origin', `http://${FOREIGN}`])
      expectStatus(answer, 403, problems)
      if (codeOf(answer) !== 'forbidden_origin')
        problems.push(`expected code forbidden_origin, got ${String(codeOf(answer))}`)
    },
  )

  const call = toolCall(options.era, 'create_draft', DRAFT)
  await probe(
    'no-token-is-401-with-challenge',
    'A request without a token is refused with 401 and the Bearer challenge',
    async (problems) => {
      const answer = await mcp(['host', publicUrl.host, ...call.headers], call.body)
      expectStatus(answer, 401, problems)
      expectHeader(
        answer,
        'www-authenticate',
        `Bearer realm="hollware", resource_metadata="${metadataOf(publicUrl)}", scope="content:read"`,
        problems,
      )
    },
  )
  await probe(
    'unknown-token-is-401-invalid-token',
    'A token nobody was issued is refused with 401 and error="invalid_token"',
    async (problems) => {
      const answer = await mcp(
        ['host', publicUrl.host, 'authorization', `Bearer ${UNKNOWN_TOKEN}`, ...call.headers],
        call.body,
      )
      expectStatus(answer, 401, problems)
      expectHeader(
        answer,
        'www-authenticate',
        `Bearer realm="hollware", resource_metadata="${metadataOf(publicUrl)}", error="invalid_token", scope="content:read"`,
        problems,
      )
    },
  )
  await probe(
    'missing-scope-is-403-with-challenge',
    'A token without content:write is refused create_draft with 403 and the challenge that names the scope',
    async (problems) => {
      const answer = await mcp(
        [
          'host',
          publicUrl.host,
          'authorization',
          `Bearer ${options.readOnlyToken}`,
          ...call.headers,
        ],
        call.body,
      )
      expectStatus(answer, 403, problems)
      expectHeader(
        answer,
        'www-authenticate',
        `Bearer error="insufficient_scope", error_description="create_draft requires: content:write", scope="content:write", resource_metadata="${metadataOf(publicUrl)}"`,
        problems,
      )
    },
  )
  const describe = toolCall(options.era, 'describe_site', {})
  await probe(
    'granted-scope-is-served',
    'A token with content:read is served describe_site',
    async (problems) => {
      const answer = await mcp(
        [
          'host',
          publicUrl.host,
          'authorization',
          `Bearer ${options.readOnlyToken}`,
          ...describe.headers,
        ],
        describe.body,
      )
      expectStatus(answer, 200, problems)
      const message = messageOf(answer)
      const result =
        typeof message === 'object' && message !== null && 'result' in message
          ? message.result
          : undefined
      const failed =
        typeof result === 'object' &&
        result !== null &&
        'isError' in result &&
        result.isError === true
      if (result === undefined || failed) problems.push('expected a result that is not an error')
    },
  )
  return results
}
