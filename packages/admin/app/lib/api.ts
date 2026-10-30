import type { OperationByName, OperationName } from '@hollware/core'
import type * as z from 'zod'
import { en, type Messages } from '../i18n/en.ts'
import type { Auth } from './auth.ts'

export type Input<Name extends OperationName> = z.input<OperationByName<Name>['input']>
export type Output<Name extends OperationName> = z.output<OperationByName<Name>['output']>

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
  readonly here: () => string
  readonly text?: () => Messages['api']
}

function pageLeftForSignIn(): Promise<never> {
  return new Promise<never>(() => {})
}

export function createApi(deps: ApiDeps) {
  const text = deps.text ?? (() => en.api)
  async function sendFor<Answer>(
    path: string,
    init: RequestInit,
    read: (response: Response) => Promise<Answer>,
  ): Promise<Answer> {
    const token = await deps.auth.token()
    if (token === null) {
      await deps.auth.signIn(deps.here())
      return pageLeftForSignIn()
    }
    const headers = new Headers(init.headers)
    headers.set('authorization', `Bearer ${token}`)
    const response = await deps.fetch(path, { ...init, headers })
    if (response.status === 401) {
      deps.auth.forget()
      await deps.auth.signIn(deps.here())
      return pageLeftForSignIn()
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
    async call<Name extends OperationName>(name: Name, input: Input<Name>): Promise<Output<Name>> {
      return (await send(`/v1/ops/${name}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })) as Output<Name>
    },

    async file(path: string): Promise<Blob> {
      return sendFor(`/v1/admin/${path}`, { method: 'GET' }, (response) => response.blob())
    },

    async backup(date: string): Promise<Blob> {
      return sendFor(`/v1/backups/${encodeURIComponent(date)}`, { method: 'GET' }, (response) =>
        response.blob(),
      )
    },

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

    async adminDelete<Answer>(path: string): Promise<Answer> {
      return (await send(`/v1/admin/${path}`, { method: 'DELETE' })) as Answer
    },
  }
}

export type Api = ReturnType<typeof createApi>
