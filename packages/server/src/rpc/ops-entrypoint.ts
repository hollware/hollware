import {
  HollwareError,
  isPersonalToken,
  OPERATIONS,
  type OperationByName,
  type OperationName,
  type ResolvedSite,
  type Scope,
} from '@hollware/core'
import { WorkerEntrypoint } from 'cloudflare:workers'
import type * as z from 'zod'
import { actorOf, createAuditLog, type AuditLogEntry } from '../audit/log.ts'
import { operationLine } from '../audit/operations.ts'
import { readBearerToken, unauthorized } from '../auth/index.ts'
import { missingScopes } from '../auth/scopes.ts'
import { checkPersonalToken, type TokenPrincipal } from '../auth/token.ts'
import { operationContext, type OperationContextDeps } from '../http/operation-context.ts'
import type { AuthRefusedLog, EnqueueFailedLog } from '../http/types.ts'
import type { HollwareEnv, HollwareOpsRpc, HollwareWorker } from '../index.ts'
import { describeError } from '../mcp/errors.ts'
import type { AuditLogFor, McpEndpoint } from '../mcp/types.ts'
import { invoke } from '../ops/invoke.ts'
import type { Handlers, OperationContext } from '../ops/types.ts'
import { forCaller, type RpcLogEntry } from './methods.ts'

export type OpsLogEntry = RpcLogEntry | AuthRefusedLog | EnqueueFailedLog | AuditLogEntry

export interface OpsDeps extends OperationContextDeps {
  readonly sites: ReadonlyMap<string, ResolvedSite>
  readonly siteKeys: ReadonlySet<string>
  readonly handlers: Handlers
  readonly mcp: McpEndpoint
  readonly log: (entry: OpsLogEntry) => void
}

const CLIENT = { name: 'binding' }

function tokenRefused(): HollwareError {
  return new HollwareError(
    'unauthorized',
    'The token was not accepted.',
    'Pass a personal token (hw_pat_) of a member of the site as { token }: create one with `hollware token create`. A read token reads over the read API only.',
  )
}

function tokenOf(options: unknown): unknown {
  return typeof options === 'object' && options !== null ? Reflect.get(options, 'token') : undefined
}

export function createOpsEntrypoint(deps: OpsDeps): HollwareWorker['HollwareOps'] {
  const principalOf = async (
    env: HollwareEnv,
    ctx: ExecutionContext,
    requestId: string,
    token: unknown,
  ): Promise<TokenPrincipal | null> => {
    if (typeof token !== 'string' || !isPersonalToken(token)) {
      deps.log({ kind: 'auth_refused', requestId, reason: token === null ? 'no_token' : 'unknown' })
      return null
    }
    await deps.refresh?.(env.DB)
    const check = await checkPersonalToken(env.DB, token, {
      sites: deps.siteKeys,
      now: deps.clock.now(),
    })
    if (!check.ok) {
      deps.log({ kind: 'auth_refused', requestId, reason: check.reason })
      return null
    }
    if (check.touch !== null) ctx.waitUntil(check.touch)
    return check.principal
  }

  const auditOf =
    (env: HollwareEnv, principal: TokenPrincipal, requestId: string): AuditLogFor =>
    (meta) =>
      createAuditLog({
        db: env.DB,
        actor: actorOf(principal, meta, null),
        requestId,
        address: null,
        master: env.HOLLWARE_SECRET,
        now: () => deps.clock.now(),
        log: deps.log,
      })

  const siteOf = (principal: TokenPrincipal): ResolvedSite => {
    const site = deps.sites.get(principal.site)
    if (site === undefined) throw new Error(`No site ${principal.site} for a checked token`)
    return site
  }

  const runOperation = async (
    env: HollwareEnv,
    ctx: ExecutionContext,
    name: unknown,
    input: unknown,
    options: unknown,
  ): Promise<unknown> => {
    const requestId = crypto.randomUUID()
    const method = `ops:${String(name)}`
    let principal: TokenPrincipal | null
    try {
      principal = await principalOf(env, ctx, requestId, tokenOf(options))
    } catch (error) {
      throw forCaller(deps, requestId, method, error)
    }
    if (principal === null) throw tokenRefused()
    const spec = OPERATIONS.find((operation) => operation.name === name)
    if (spec === undefined) {
      throw new HollwareError(
        'invalid_input',
        `There is no operation ${String(name)}.`,
        'Use the name of an operation, as tools/list of MCP lists them.',
      )
    }
    const site = siteOf(principal)
    const audit = auditOf(env, principal, requestId)(CLIENT)
    const scopes: readonly Scope[] = spec.scopes
    const missing = missingScopes(principal, scopes)
    if (missing.length > 0) {
      const line = operationLine(spec, null, site.key, { errorCode: 'insufficient_scope' })
      if (line !== null) await audit.write(site, line)
      throw new HollwareError(
        'insufficient_scope',
        `The token lacks a scope this operation requires. Missing: ${missing.join(', ')}.`,
        "Pass a token that carries every missing scope: create one with `hollware token create`. A token only gets the scopes its user's role allows.",
      )
    }
    const parsed = spec.input.safeParse(input ?? {})
    if (!parsed.success) {
      const issues = parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`,
      )
      throw new HollwareError(
        'invalid_input',
        `The input of ${spec.name} is not valid: ${issues.join('; ')}`,
        'Send the input of the operation as its input schema describes it.',
      )
    }
    const context: OperationContext = {
      ...operationContext(deps, env, ctx, site, requestId),
      principal,
      view: 'head',
      client: CLIENT,
      requestId,
    }
    const audited = async (result: { output: unknown } | { errorCode: string }) => {
      const line = operationLine(spec, parsed.data, site.key, result)
      if (line !== null) await audit.write(site, line)
    }
    try {
      const output = spec.output.parse(await invoke(deps.handlers, spec, parsed.data, context))
      await audited({ output })
      return output
    } catch (error) {
      await audited({ errorCode: error instanceof HollwareError ? error.code : 'internal' })
      throw forCaller(deps, requestId, method, error)
    }
  }

  const serveMcp = async (
    env: HollwareEnv,
    ctx: ExecutionContext,
    request: Request,
  ): Promise<Response> => {
    const requestId = crypto.randomUUID()
    const token = readBearerToken(request)
    try {
      const principal = await principalOf(env, ctx, requestId, token)
      if (principal === null) return unauthorized(token === null ? undefined : 'unknown')
      return await deps.mcp.fetch(request, {
        principal,
        requestId,
        context: operationContext(deps, env, ctx, siteOf(principal), requestId),
        audit: {
          log: auditOf(env, principal, requestId),
          defer: (work) => {
            ctx.waitUntil(work)
          },
        },
      })
    } catch (error) {
      deps.log({
        kind: 'rpc_error',
        requestId,
        method: 'fetch',
        errorCode: null,
        detail: describeError(error),
      })
      return Response.json(
        {
          code: 'internal',
          message: 'The request failed on the server.',
          fix: `Try again. If it keeps failing, give the site operator this request id: ${requestId}.`,
        },
        { status: 500, headers: { 'cache-control': 'no-store' } },
      )
    }
  }

  return class HollwareOps extends WorkerEntrypoint<HollwareEnv> implements HollwareOpsRpc {
    ops<Name extends OperationName>(
      name: Name,
      input: z.input<OperationByName<Name>['input']>,
      options: { readonly token: string },
    ): Promise<z.output<OperationByName<Name>['output']>> {
      return runOperation(this.env, this.ctx, name, input, options) as Promise<
        z.output<OperationByName<Name>['output']>
      >
    }

    override fetch(request: Request): Promise<Response> {
      return serveMcp(this.env, this.ctx, request)
    }
  }
}
