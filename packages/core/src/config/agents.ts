import { isId } from '../ids.ts'
import { AGENT_DEFAULT_SCOPES, AGENT_SCOPE_CEILING, isScope, type Scope } from '../scopes.ts'
import type { Problems } from './config-error.ts'
import type { AgentEventKind, ResolvedAgent, ResolvedReview } from './types.ts'
import { isRecord, itemPath, keyPath, quote, wrongType } from './values.ts'

export const AGENT_EVENT_KINDS = [
  'review.requested',
  'review.decided',
  'entry.published',
  'entry.unpublished',
  'site.changed',
] as const

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const BINDING_NAME = /^[A-Z][A-Z0-9_]*$/
const RESERVED = /^(HOLLWARE|CLOUDFLARE|CF)_|^(DB|EVENTS|OAUTH_KV)$/
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

const AGENT_FIX =
  'Declare it as { name: "reviewer", member: "usr_…", events: ["review.requested"], delivery: { kind: "binding", binding: "AGENTS" } }.'

export const NO_REVIEW: ResolvedReview = { requireAgents: false }

function isAgentEvent(value: unknown): value is AgentEventKind {
  return AGENT_EVENT_KINDS.some((kind) => kind === value)
}

export function isAgentUrl(value: string): boolean {
  if (!URL.canParse(value)) return false
  const url = new URL(value)
  return url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.has(url.hostname))
}

function readEventsOf(path: string, raw: unknown, problems: Problems): AgentEventKind[] | null {
  if (!Array.isArray(raw) || raw.length === 0) {
    problems.add(
      path,
      wrongType(raw, 'a list of events'),
      `List at least one of ${AGENT_EVENT_KINDS.map(quote).join(', ')}.`,
    )
    return null
  }
  const kinds: AgentEventKind[] = []
  const items: readonly unknown[] = raw
  let ok = true
  items.forEach((item, index) => {
    if (!isAgentEvent(item)) {
      problems.add(
        itemPath(path, index),
        wrongType(item, 'an event an agent hears'),
        `Use one of ${AGENT_EVENT_KINDS.map(quote).join(', ')}.`,
      )
      ok = false
      return
    }
    if (!kinds.includes(item)) kinds.push(item)
  })
  return ok ? kinds : null
}

function readDelivery(
  path: string,
  raw: unknown,
  problems: Problems,
): ResolvedAgent['delivery'] | null {
  if (!isRecord(raw)) {
    problems.add(
      path,
      wrongType(raw, 'a delivery'),
      'Declare { kind: "webhook", url: "https://…" } or { kind: "binding", binding: "AGENTS" }.',
    )
    return null
  }
  if (raw['kind'] === 'webhook') {
    const url = raw['url']
    if (typeof url !== 'string' || !isAgentUrl(url)) {
      problems.add(
        keyPath(path, 'url'),
        wrongType(url, 'an https URL'),
        'Give the https URL that receives the events; http only for localhost.',
      )
      return null
    }
    const secret = raw['secret']
    if (secret === undefined) return { kind: 'webhook', url, secret: null }
    if (typeof secret !== 'string' || !BINDING_NAME.test(secret) || RESERVED.test(secret)) {
      problems.add(
        keyPath(path, 'secret'),
        wrongType(secret, 'the name of a Worker secret of your own'),
        'Name the secret that signs the deliveries, such as "AGENT_SECRET", or leave it out for Hollware to make one with make_webhook_secret.',
      )
      return null
    }
    return { kind: 'webhook', url, secret }
  }
  if (raw['kind'] === 'binding') {
    const binding = raw['binding']
    if (typeof binding !== 'string' || !BINDING_NAME.test(binding) || RESERVED.test(binding)) {
      problems.add(
        keyPath(path, 'binding'),
        wrongType(binding, 'the name of a service binding of your own'),
        'Name the service binding of the Worker that runs the agent, such as "AGENTS".',
      )
      return null
    }
    return { kind: 'binding', binding }
  }
  problems.add(
    keyPath(path, 'kind'),
    wrongType(raw['kind'], '"webhook" or "binding"'),
    'Deliver to a URL with "webhook", or to a Worker of the account with "binding".',
  )
  return null
}

function readScopes(path: string, raw: unknown, problems: Problems): Scope[] | null {
  if (raw === undefined) return [...AGENT_DEFAULT_SCOPES]
  if (!Array.isArray(raw) || raw.length === 0) {
    problems.add(
      path,
      wrongType(raw, 'a list of scopes'),
      `List scopes among ${AGENT_SCOPE_CEILING.map(quote).join(', ')}, or leave it out.`,
    )
    return null
  }
  const scopes: Scope[] = []
  const items: readonly unknown[] = raw
  let ok = true
  items.forEach((item, index) => {
    if (typeof item !== 'string' || !isScope(item)) {
      problems.add(
        itemPath(path, index),
        wrongType(item, 'a scope'),
        'Name a scope, such as "review:comment".',
      )
      ok = false
      return
    }
    if (!AGENT_SCOPE_CEILING.includes(item)) {
      problems.add(
        itemPath(path, index),
        `is ${quote(item)}, which an agent may not have`,
        `An agent is an author: ask only for ${AGENT_SCOPE_CEILING.map(quote).join(', ')}.`,
      )
      ok = false
      return
    }
    if (!scopes.includes(item)) scopes.push(item)
  })
  return ok ? scopes : null
}

function readAgent(path: string, raw: unknown, problems: Problems): ResolvedAgent | null {
  if (!isRecord(raw)) {
    problems.add(path, wrongType(raw, 'an agent'), AGENT_FIX)
    return null
  }
  const name = raw['name']
  const nameOk = typeof name === 'string' && NAME.test(name)
  if (!nameOk) {
    problems.add(
      keyPath(path, 'name'),
      wrongType(name, 'a name'),
      'Name it with lowercase words joined by hyphens, such as "reviewer".',
    )
  }
  const member = raw['member']
  const memberOk = typeof member === 'string' && isId('usr', member)
  if (!memberOk) {
    problems.add(
      keyPath(path, 'member'),
      wrongType(member, 'the id of an agent member'),
      'Make an agent member in the admin (Agents) or with `hollware agent add`, and give its id (usr_…).',
    )
  }
  const events = readEventsOf(keyPath(path, 'events'), raw['events'], problems)
  const delivery = readDelivery(keyPath(path, 'delivery'), raw['delivery'], problems)
  const scopes = readScopes(keyPath(path, 'scopes'), raw['scopes'], problems)
  const required = raw['required']
  if (required !== undefined && typeof required !== 'boolean') {
    problems.add(
      keyPath(path, 'required'),
      wrongType(required, 'true or false'),
      'Set required to true for an approval to wait for this agent, or leave it out.',
    )
    return null
  }
  if (!nameOk || !memberOk || events === null || delivery === null || scopes === null) return null
  return { name, member, events, delivery, scopes, required: required === true }
}

export function readAgents(path: string, raw: unknown, problems: Problems): ResolvedAgent[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) {
    problems.add(path, wrongType(raw, 'a list of agents'), AGENT_FIX)
    return []
  }
  const agents: ResolvedAgent[] = []
  const items: readonly unknown[] = raw
  items.forEach((item, index) => {
    const at = itemPath(path, index)
    const agent = readAgent(at, item, problems)
    if (agent === null) return
    if (agents.some((other) => other.name === agent.name)) {
      problems.add(
        at,
        `repeats the name ${quote(agent.name)}`,
        'Give each agent a name of its own.',
      )
      return
    }
    agents.push(agent)
  })
  return agents
}

export function readReview(path: string, raw: unknown, problems: Problems): ResolvedReview {
  if (raw === undefined) return NO_REVIEW
  if (!isRecord(raw)) {
    problems.add(path, wrongType(raw, 'an object'), 'Declare it as { requireAgents: false }.')
    return NO_REVIEW
  }
  const required = raw['requireAgents']
  if (required === undefined) return NO_REVIEW
  if (typeof required !== 'boolean') {
    problems.add(
      keyPath(path, 'requireAgents'),
      wrongType(required, 'true or false'),
      'Set it to true for an approval to wait for the agents marked required.',
    )
    return NO_REVIEW
  }
  return { requireAgents: required }
}
