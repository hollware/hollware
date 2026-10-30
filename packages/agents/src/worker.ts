import type { AgentGrant, HollwareEvent } from '@hollware/core'

import { auditStep, writeReport, type ReportOptions } from './auditor.ts'
import { grantHollware, mcpHollware } from './hollware.ts'
import { kvMemory, type Memory } from './memory.ts'
import { capped, DailyLimitReached, DEFAULT_MODEL, workersAiModel, type Model } from './model.ts'
import { reviewById, reviewPending } from './reviewer.ts'
import { translateMissing } from './translator.ts'

/** The bindings and variables of the Worker of the agents. */
export interface AgentsEnv {
  /** A service binding to the Hollware Worker; without it, the agents reach it over the network. */
  readonly HOLLWARE?: { fetch(request: Request): Promise<Response> }
  /** The public URL of Hollware, such as https://cms.example.com. */
  readonly HOLLWARE_PUBLIC_URL: string
  /**
   * A personal token of the site, with content:read and content:write (a secret), for the roles of
   * the cron; without it they skip, and only the events Hollware delivers to `handle` are worked.
   */
  readonly HOLLWARE_AGENT_TOKEN?: string
  /** Workers AI, for the default model. */
  readonly AI?: { run(model: string, input: object, options?: object): Promise<unknown> }
  /** What the agents remember: the reviews they read, the translations they tried, the day's calls. */
  readonly AGENTS_KV: {
    get(key: string): Promise<string | null>
    put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
  }
  /** Where the weekly report is posted as well, such as a Slack incoming webhook (a secret). */
  readonly AGENTS_WEBHOOK_URL?: string
}

/** The options of `createHollwareAgents`. */
export interface AgentsOptions {
  /** A model of Workers AI by its id, or a model of your own; `DEFAULT_MODEL` when not given. */
  readonly model?: string | Model
  /** The id of an AI Gateway for the calls to Workers AI. */
  readonly gateway?: string
  /** The model calls of a day, at most; 100 by default. */
  readonly dailyLimit?: number
  /** The reviewer comments on pending reviews; on by default. */
  readonly reviewer?: boolean
  /** The translator drafts missing translations, at most `limit` a run (3); on by default. */
  readonly translator?: boolean | { readonly limit?: number }
  /**
   * The auditor writes a report every `everyDays` days (7), on the first trigger after; off unless
   * a collection for it is given.
   */
  readonly auditor?:
    | false
    | (ReportOptions & { readonly everyDays?: number; readonly staleDays?: number })
  /** The time; the system clock when absent. */
  readonly clock?: () => Date
}

export const ROLES = ['reviewer', 'translator', 'auditor'] as const

/** The role whose turn it is at `time`: the ten minutes of the time, in turn. */
export function roleAt(time: number): (typeof ROLES)[number] {
  return ROLES[Math.floor(time / 600_000) % ROLES.length] ?? 'reviewer'
}

export const LAST_AUDIT = 'audit:last'

export function auditDue(last: string | null, day: string, everyDays: number): boolean {
  return last === null || Date.parse(day) - Date.parse(last) >= everyDays * 86_400_000
}

export interface AgentsWorker {
  /**
   * One run of the agents, awaited: what a named entrypoint calls when Hollware's own cron wakes
   * the agents over a service binding, so that they need no cron trigger of their own.
   */
  readonly run: (env: AgentsEnv) => Promise<void>
  /**
   * An event Hollware delivers to the agent, with the grant that acts as its member for it: on
   * `review.requested` the reviewer comments on that review. A failure is thrown, so Hollware
   * delivers the event again; reaching the day's limit of model calls ends it quietly.
   */
  readonly handle: (event: HollwareEvent, grant: AgentGrant, env: AgentsEnv) => Promise<void>
  readonly scheduled: (
    controller: { readonly cron: string },
    env: AgentsEnv,
    ctx: { waitUntil(promise: Promise<unknown>): void },
  ) => Promise<void>
  readonly fetch: (request: Request, env: AgentsEnv) => Promise<Response>
}

function log(entry: object): void {
  console.log(JSON.stringify({ source: 'hollware-agents', ...entry }))
}

/**
 * The Worker of the agents. Hollware's cron wakes them every ten minutes over a service binding
 * (`run`), or a cron trigger of their own does (`scheduled`). Each run is one role, in turn: the
 * reviewer, the translator, then the auditor, which checks a dozen entries and writes its report
 * when it is due. A free Worker makes fifty calls a run at most, which one role fits in. A role
 * that fails is logged; reaching the day's limit of model calls ends it quietly.
 */
export function createHollwareAgents(options: AgentsOptions = {}): AgentsWorker {
  const clock = options.clock ?? (() => new Date())
  const auditor = options.auditor === undefined ? false : options.auditor

  const fetchOf =
    (env: AgentsEnv) =>
    (request: Request): Promise<Response> =>
      env.HOLLWARE === undefined ? fetch(request) : env.HOLLWARE.fetch(request)

  const modelOf = (env: AgentsEnv, memory: Memory): Model => {
    const chosen = options.model ?? DEFAULT_MODEL
    const base: Model =
      typeof chosen === 'function'
        ? chosen
        : (messages) => {
            if (env.AI === undefined)
              throw new Error('The agents need the AI binding for a Workers AI model')
            return workersAiModel(
              env.AI,
              chosen,
              options.gateway === undefined ? {} : { gateway: options.gateway },
            )(messages)
          }
    const today = () => clock().toISOString().slice(0, 10)
    return capped(base, memory, options.dailyLimit ?? 100, today)
  }

  const depsOf = (env: AgentsEnv, token: string) => {
    const hollware = mcpHollware({ url: env.HOLLWARE_PUBLIC_URL, token, fetch: fetchOf(env) })
    const memory = kvMemory(env.AGENTS_KV)
    return { hollware, memory, model: modelOf(env, memory) }
  }

  const run = async (role: string, work: () => Promise<object>): Promise<boolean> => {
    try {
      log({ role, ...(await work()) })
      return true
    } catch (error) {
      if (error instanceof DailyLimitReached) {
        log({ role, stopped: error.message })
        return false
      }
      log({ role, failed: error instanceof Error ? error.message : String(error) })
      return true
    }
  }

  const runOnce = async (env: AgentsEnv): Promise<void> => {
    const now = clock()
    const role = roleAt(now.getTime())
    const token = env.HOLLWARE_AGENT_TOKEN
    if (token === undefined || token === '') {
      log({ role, skipped: 'HOLLWARE_AGENT_TOKEN is not set' })
      return
    }
    const deps = depsOf(env, token)
    if (role === 'reviewer') {
      if (options.reviewer !== false) await run('reviewer', () => reviewPending(deps))
      return
    }
    if (role === 'translator') {
      if (options.translator === false) return
      const limit = typeof options.translator === 'object' ? options.translator.limit : undefined
      await run('translator', () => translateMissing(deps, limit === undefined ? {} : { limit }))
      return
    }
    if (auditor === false) return
    await run('auditor', () => auditStep(deps, { report: auditor, now: now.toISOString() }))
    const day = now.toISOString().slice(0, 10)
    if (!auditDue(await deps.memory.get(LAST_AUDIT), day, auditor.everyDays ?? 7)) return
    const url = env.AGENTS_WEBHOOK_URL
    const done = await run('report', () =>
      writeReport(
        {
          hollware: deps.hollware,
          memory: deps.memory,
          webhook:
            url === undefined || url === ''
              ? undefined
              : async (report) => {
                  const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ text: report }),
                  })
                  if (!response.ok) throw new Error(`The webhook answered ${response.status}`)
                },
        },
        {
          report: auditor,
          day,
          ...(auditor.staleDays === undefined ? {} : { staleDays: auditor.staleDays }),
        },
      ),
    )
    if (done) await deps.memory.put(LAST_AUDIT, day)
  }

  const handle = async (event: HollwareEvent, grant: AgentGrant, env: AgentsEnv): Promise<void> => {
    if (event.kind !== 'review.requested' || options.reviewer === false) return
    const id = grant.review ?? event.review.id
    const memory = kvMemory(env.AGENTS_KV)
    const deps = {
      hollware: grantHollware(grant, fetchOf(env)),
      memory,
      model: modelOf(env, memory),
    }
    try {
      log({ role: 'reviewer', review: id, ...(await reviewById(deps, id)) })
    } catch (error) {
      if (error instanceof DailyLimitReached) {
        log({ role: 'reviewer', review: id, stopped: error.message })
        return
      }
      log({
        role: 'reviewer',
        review: id,
        failed: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  return {
    run: runOnce,
    handle,
    async scheduled(_controller, env, ctx) {
      ctx.waitUntil(runOnce(env))
    },
    async fetch(request) {
      const { pathname } = new URL(request.url)
      return pathname === '/health'
        ? Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } })
        : new Response('Not found', { status: 404 })
    },
  }
}
