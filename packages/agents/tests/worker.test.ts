import { describe, expect, it } from 'vite-plus/test'

import {
  auditDue,
  createHollwareAgents,
  LAST_AUDIT,
  roleAt,
  type AgentsEnv,
} from '../src/worker.ts'

// Fails when: the Worker of the agents (src/worker.ts) stops running one role a run, in turn by
// the ten minutes of the time (the reviewer, the translator, the auditor), writes the report more
// than once in its days, stops remembering the day of the last one, or reaches Hollware other than
// through the binding at its public URL with the token.

describe('roleAt', () => {
  it('takes the roles in turn, ten minutes each', () => {
    expect(
      ['10:00', '10:10', '10:20', '10:30', '10:50'].map((time) =>
        roleAt(Date.parse(`2026-10-15T${time}:00Z`)),
      ),
    ).toEqual(['reviewer', 'translator', 'auditor', 'reviewer', 'auditor'])
  })
})

describe('auditDue', () => {
  it('is due with no audit yet, or once the days have passed', () => {
    expect(auditDue(null, '2026-10-15', 7)).toBe(true)
    expect(auditDue('2026-10-09', '2026-10-15', 7)).toBe(false)
    expect(auditDue('2026-10-08', '2026-10-15', 7)).toBe(true)
  })
})

/** Hollware over MCP, answering each tool with a canned output, and what it was asked. */
function fakeHollware() {
  const calls: { url: string; auth: string | null; tool: string }[] = []
  const outputs: Record<string, object> = {
    describe_site: { outcome: 'ok', site: { locales: ['es', 'en'], collections: [] } },
    list_reviews: { outcome: 'ok', reviews: [] },
    content_stats: { outcome: 'unavailable' },
    get_entry: { outcome: 'not_found' },
    create_draft: { outcome: 'saved', entry: { id: 'ent_1', version: 1 } },
  }
  return {
    calls,
    async fetch(request: Request) {
      const body: unknown = await request.json()
      const params: unknown =
        typeof body === 'object' && body !== null && 'params' in body ? body.params : null
      const tool =
        typeof params === 'object' && params !== null && 'name' in params ? String(params.name) : ''
      calls.push({ url: request.url, auth: request.headers.get('authorization'), tool })
      return Response.json({
        jsonrpc: '2.0',
        id: 1,
        result: { structuredContent: outputs[tool] ?? {} },
      })
    },
  }
}

function fakeKv() {
  const values = new Map<string, string>()
  return {
    values,
    get: async (key: string) => values.get(key) ?? null,
    put: async (key: string, value: string) => {
      values.set(key, value)
    },
  }
}

describe('createHollwareAgents', () => {
  it('runs one role a run, in turn, and writes the report once in its days', async () => {
    const hollware = fakeHollware()
    const kv = fakeKv()
    const env: AgentsEnv = {
      HOLLWARE: hollware,
      HOLLWARE_PUBLIC_URL: 'https://cms.example.com',
      HOLLWARE_AGENT_TOKEN: 'hw_pat_agents',
      AGENTS_KV: kv,
    }
    let now = new Date()
    const agents = createHollwareAgents({
      model: async () => '',
      auditor: { collection: 'reports', locale: 'en' },
      clock: () => now,
    })
    const toolsAt = async (time: string) => {
      now = new Date(`2026-10-15T${time}:00Z`)
      const before = hollware.calls.length
      await agents.run(env)
      return hollware.calls.slice(before).map((call) => call.tool)
    }

    const reviewer = await toolsAt('10:00')
    const translator = await toolsAt('10:10')
    const auditor = await toolsAt('10:20')
    const auditorAgain = await toolsAt('10:50')

    expect([reviewer, translator, auditor, auditorAgain]).toEqual([
      ['describe_site', 'list_reviews'],
      ['describe_site'],
      ['describe_site', 'content_stats', 'get_entry', 'create_draft'],
      ['describe_site'],
    ])
    expect(kv.values.get(LAST_AUDIT)).toBe('2026-10-15')
    expect(new Set(hollware.calls.map((call) => `${call.url} ${call.auth}`))).toEqual(
      new Set(['https://cms.example.com/mcp Bearer hw_pat_agents']),
    )
  })
})
