import type { OperationByName, OperationName } from '@hollware/core'
import type * as z from 'zod'
import { en, type Messages } from '../i18n/en.ts'
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
  /** The texts of an error the server gives none for, in the admin's language; English if not given. */
  readonly text?: () => Messages['api']
}

export function createApi(deps: ApiDeps) {
  const text = deps.text ?? (() => en.api)
  /** A request with the token; on a refusal of the token, the person signs in again. */
  async function sendFor<Answer>(
    path: string,
    init: RequestInit,
    read: (response: Response) => Promise<Answer>,
  ): Promise<Answer> {
    const token = await deps.auth.token()
    if (token === null) {
      await deps.auth.signIn(deps.here())
      // The page is leaving for the sign-in; nothing waits for this answer.
      return new Promise<never>(() => {})
    }
    const headers = new Headers(init.headers)
    headers.set('authorization', `Bearer ${token}`)
    const response = await deps.fetch(path, { ...init, headers })
    if (response.status === 401) {
      deps.auth.forget()
      await deps.auth.signIn(deps.here())
      return new Promise<never>(() => {})
    }
    if (response.ok) return read(response)
    const body: unknown = await response.json()
    const error = (body ?? {}) as { code?: string; message?: string; fix?: string }
    throw new ApiError(
      error.code ?? 'internal',
      error.message ?? text().answered(response.status),
      error.fix ?? text().tryAgain,
    )
  }
  const send = (path: string, init: RequestInit): Promise<unknown> =>
    sendFor(path, init, (response) => response.json() as Promise<unknown>)

  return {
    /** An operation, as the MCP tool of that name takes and answers it. */
    async call<Name extends OperationName>(name: Name, input: Input<Name>): Promise<Output<Name>> {
      return (await send(`/v1/ops/${name}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })) as Output<Name>
    },

    /** A file of the admin's own routes, such as the CSV of the activity log, with the token. */
    async file(path: string): Promise<Blob> {
      return sendFor(`/v1/admin/${path}`, { method: 'GET' }, (response) => response.blob())
    },

    /** One of the admin's own routes, `/v1/admin/…`: tokens and invitations. */
    async admin<Answer>(path: string, body?: unknown): Promise<Answer> {
      return (await send(
        `/v1/admin/${path}`,
        body === undefined
          ? { method: 'GET' }
          : {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            },
      )) as Answer
    },
  }
}

export type Api = ReturnType<typeof createApi>
