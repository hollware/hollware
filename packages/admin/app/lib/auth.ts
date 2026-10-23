import { en, type Messages } from '../i18n/en.ts'
import { challengeOf, randomValue } from './pkce.ts'

export interface AdminConfig {
  readonly issuer: string
  readonly clientId: string
  readonly redirectUri: string
  readonly resource: string
  readonly scope: string
}

interface Tokens {
  readonly access: string
  readonly refresh: string | null
  readonly expiresAt: number
}

interface Pending {
  readonly verifier: string
  readonly state: string
  readonly returnTo: string
}

export interface AuthDeps {
  readonly fetch: typeof fetch
  readonly navigate: (url: string) => void
  readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  readonly now: () => number
  readonly text?: () => Messages['auth']
}

const PENDING = 'hollware:sign-in'
const SITE = 'hollware:site'

const SIGN_OUT = '/authorize/signout'

const MARGIN_MS = 60_000

export class SignInError extends Error {
  override readonly name = 'SignInError'
}

export function createAuth(deps: AuthDeps) {
  let config: Promise<AdminConfig> | null = null
  let tokens: Tokens | null = null
  const text = deps.text ?? (() => en.auth)

  const loadConfig = (): Promise<AdminConfig> => {
    config ??= deps.fetch('/admin/config.json').then(async (response) => {
      if (!response.ok) throw new SignInError(text().noSettings(response.status))
      return (await response.json()) as AdminConfig
    })
    return config
  }

  const keep = (answer: {
    access_token: string
    refresh_token?: string
    expires_in?: number
  }): string => {
    tokens = {
      access: answer.access_token,
      refresh: answer.refresh_token ?? null,
      expiresAt: deps.now() + (answer.expires_in ?? 3600) * 1000,
    }
    return tokens.access
  }

  const exchange = async (body: Record<string, string>) => {
    const settings = await loadConfig()
    const response = await deps.fetch('/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        ...body,
        client_id: settings.clientId,
        resource: settings.resource,
      }),
    })
    if (!response.ok) return null
    return (await response.json()) as {
      access_token: string
      refresh_token?: string
      expires_in?: number
    }
  }

  return {
    async signIn(returnTo: string): Promise<void> {
      const settings = await loadConfig()
      const pending: Pending = { verifier: randomValue(), state: randomValue(16), returnTo }
      deps.storage.setItem(PENDING, JSON.stringify(pending))
      const query = new URLSearchParams({
        response_type: 'code',
        client_id: settings.clientId,
        redirect_uri: settings.redirectUri,
        scope: settings.scope,
        state: pending.state,
        code_challenge: await challengeOf(pending.verifier),
        code_challenge_method: 'S256',
        resource: settings.resource,
      })
      const site = deps.storage.getItem(SITE)
      if (site !== null) query.set('site', site)
      deps.navigate(`/authorize?${query.toString()}`)
    },

    async switchSite(site: string, returnTo: string): Promise<void> {
      deps.storage.setItem(SITE, site)
      tokens = null
      await this.signIn(returnTo)
    },

    async complete(callback: URL): Promise<string> {
      const stored = deps.storage.getItem(PENDING)
      deps.storage.removeItem(PENDING)
      const pending = stored === null ? null : (JSON.parse(stored) as Pending)
      const code = callback.searchParams.get('code')
      if (
        pending === null ||
        code === null ||
        callback.searchParams.get('state') !== pending.state
      ) {
        throw new SignInError(callback.searchParams.get('error_description') ?? text().lost)
      }
      const settings = await loadConfig()
      const answer = await exchange({
        grant_type: 'authorization_code',
        code,
        redirect_uri: settings.redirectUri,
        code_verifier: pending.verifier,
      })
      if (answer === null) throw new SignInError(text().refused)
      keep(answer)
      return pending.returnTo
    },

    async token(): Promise<string | null> {
      if (tokens === null) return null
      if (tokens.expiresAt - deps.now() > MARGIN_MS) return tokens.access
      if (tokens.refresh === null) {
        tokens = null
        return null
      }
      const answer = await exchange({ grant_type: 'refresh_token', refresh_token: tokens.refresh })
      if (answer === null) {
        tokens = null
        return null
      }
      return keep(answer)
    },

    forget(): void {
      tokens = null
    },

    async signOut(): Promise<void> {
      const refresh = tokens?.refresh ?? null
      tokens = null
      try {
        if (refresh !== null) {
          const settings = await loadConfig()
          await deps.fetch('/oauth/token', {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              token: refresh,
              token_type_hint: 'refresh_token',
              client_id: settings.clientId,
            }),
          })
        }
        await deps.fetch(SIGN_OUT, { method: 'POST', credentials: 'same-origin' })
      } finally {
        deps.navigate(`/signin?return_to=${encodeURIComponent('/admin/')}`)
      }
    },
  }
}

export type Auth = ReturnType<typeof createAuth>
