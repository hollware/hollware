import type { OperationByName, OperationName } from '@hollware/core'
import type * as z from 'zod'
import type { Auth } from './auth.ts'

/**
 * The operations as the admin calls them: `POST /v1/ops/{name}`, the contract of the MCP tool of
 * that name (ADR-026). A call without a token, or with one the server refuses, sends the person to
 * sign in and back to where they were.
 */

export type Input<Name extends OperationName> = z.input<OperationByName<Name>['input']>
export type Output<Name extends OperationName> = z.output<OperationByName<Name>['output']>

/** An error the server answered in words: its code, what happened and how to fix it. */
export class ApiError extends Error {
  override readonly name = 'ApiError'
  readonly code: string
  readonly fix: string

  constructor(code: string, message: string, fix: string) {
    super(message)
    this.code = code
    this.fix = fix
  }
}

export interface ApiDeps {
  readonly fetch: typeof fetch
  readonly auth: Auth
  /** Where the person is in the admin, to come back to after signing in. */
  readonly here: () => string
}

export function createApi(deps: ApiDeps) {
  return {
    async call<Name extends OperationName>(name: Name, input: Input<Name>): Promise<Output<Name>> {
      const token = await deps.auth.token()
      if (token === null) {
        await deps.auth.signIn(deps.here())
        // The page is leaving for the sign-in; nothing waits for this answer.
        return new Promise<never>(() => {})
      }
      const response = await deps.fetch(`/v1/ops/${name}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (response.status === 401) {
        deps.auth.forget()
        await deps.auth.signIn(deps.here())
        return new Promise<never>(() => {})
      }
      const body: unknown = await response.json()
      if (!response.ok) {
        const error = (body ?? {}) as { code?: string; message?: string; fix?: string }
        throw new ApiError(
          error.code ?? 'internal',
          error.message ?? `The server answered ${response.status}.`,
          error.fix ?? 'Try again.',
        )
      }
      return body as Output<Name>
    },
  }
}

export type Api = ReturnType<typeof createApi>
