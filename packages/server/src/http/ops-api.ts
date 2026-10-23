import { operationLine } from '../audit/operations.ts'
import type { RequestPrincipal } from '../auth/types.ts'
import type { AuditLogFor } from '../mcp/index.ts'
import { HollwareError, OPERATIONS, type Scope } from '@hollware/core'
import type { Context, Hono } from 'hono'
import { insufficientScope } from '../auth/index.ts'
import { missingScopes } from '../auth/scopes.ts'
import { createD1Store } from '../db/index.ts'
import type { Handlers, OperationContext } from '../ops/types.ts'
import type { Proceed } from '../oauth/server.ts'
import type { Clock, Structure } from '../ports.ts'
import { describeError } from '../mcp/errors.ts'
import type { ResolvedSite } from '@hollware/core'
import type { GatewayEnv, GatewayLogEntry } from './types.ts'
import { semanticOfEnv } from '../semantic/cloudflare.ts'
import { mediaOfEnv } from '../media/cloudflare.ts'
import { analyticsSourcesOf } from '../analytics/env.ts'
import { backupsIn } from '../backup/run.ts'
import { invoke } from '../ops/invoke.ts'

export interface OpsApiOptions {
  readonly sites: ReadonlyMap<string, ResolvedSite>
  readonly handlers: Handlers
  readonly clock: Clock
  readonly log: (entry: GatewayLogEntry) => void
  readonly protect: (c: Context<GatewayEnv>, proceed: Proceed) => Promise<Response>
  readonly metadataUrl: (c: Context<GatewayEnv>) => string
  readonly structure?: (db: D1Database, master?: string) => Structure
  readonly notify: (
    c: Context<GatewayEnv>,
    requestId: string,
    site: string,
  ) => (ids: readonly string[]) => void
  readonly audit?: (c: Context<GatewayEnv>, principal: RequestPrincipal) => Promise<AuditLogFor>
}

const CLIENT = { name: 'hollware-admin' }

const STATUS: Readonly<Record<string, 400 | 404 | 500 | 504>> = {
  invalid_input: 400,
  unknown_collection: 404,
  unknown_locale: 404,
  timeout: 504,
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
}

export function installOpsApi(app: Hono<GatewayEnv>, options: OpsApiOptions): void {
  app.post('/v1/ops/:name', async (c) =>
    options.protect(c, async (principal) => {
      const requestId = c.get('requestId')
      const spec = OPERATIONS.find((operation) => operation.name === c.req.param('name'))
      if (spec === undefined) {
        return json(
          {
            code: 'invalid_input',
            message: `There is no operation ${c.req.param('name')}.`,
            fix: 'Use the name of an operation, as tools/list of MCP lists them.',
          },
          404,
        )
      }
      const site = options.sites.get(principal.site)
      if (site === undefined) throw new Error(`No site ${principal.site} for a checked token`)
      const audit = options.audit === undefined ? null : (await options.audit(c, principal))(CLIENT)
      const scopes: readonly Scope[] = spec.scopes
      const missing = missingScopes(principal, scopes)
      if (missing.length > 0) {
        const line = operationLine(spec, null, site.key, { errorCode: 'insufficient_scope' })
        if (line !== null) await audit?.write(site, line)
        return insufficientScope(scopes, options.metadataUrl(c))
      }
      const body: unknown = await c.req.json().catch(() => undefined)
      const parsed = spec.input.safeParse(body ?? {})
      if (!parsed.success) {
        const issues = parsed.error.issues.map(
          (issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`,
        )
        return json(
          {
            code: 'invalid_input',
            message: `The input of ${spec.name} is not valid: ${issues.join('; ')}`,
            fix: 'Send the input of the operation as its input schema describes it.',
          },
          400,
        )
      }
      const context: OperationContext = {
        site,
        principal,
        view: 'head',
        store: createD1Store(c.env.DB, { clock: options.clock }),
        clock: options.clock,
        client: CLIENT,
        requestId,
        notify: options.notify(c, requestId, site.key),
        semantic: semanticOfEnv(c.env),
        analytics: analyticsSourcesOf(c.env, () => options.clock.now()),
        media: mediaOfEnv(c.env),
        backups: c.env.MEDIA === undefined ? null : backupsIn(c.env.MEDIA),
        ...(options.structure === undefined
          ? {}
          : { structure: options.structure(c.env.DB, c.env.HOLLWARE_SECRET) }),
      }
      const audited = async (result: { output: unknown } | { errorCode: string }) => {
        const line = operationLine(spec, parsed.data, site.key, result)
        if (line !== null) await audit?.write(site, line)
      }
      try {
        const output = spec.output.parse(await invoke(options.handlers, spec, parsed.data, context))
        await audited({ output })
        return json(output)
      } catch (error) {
        await audited({ errorCode: error instanceof HollwareError ? error.code : 'internal' })
        if (error instanceof HollwareError) {
          return json(
            { code: error.code, message: error.message, fix: error.fix },
            STATUS[error.code] ?? 500,
          )
        }
        options.log({
          kind: 'request_error',
          requestId,
          method: 'POST',
          path: c.req.path,
          detail: describeError(error),
        })
        return json(
          {
            code: 'internal',
            message: 'The operation failed on the server.',
            fix: `Try again. If it keeps failing, give the site operator this request id: ${requestId}.`,
          },
          500,
        )
      }
    }),
  )
}
