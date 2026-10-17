import { en, type Messages } from '../i18n/en.ts'
import { challengeOf, randomValue } from './pkce.ts'

/**
 * How the admin signs in (ADR-026): it is the server's own OAuth client, so it sends the person to
 * `/authorize` with PKCE, and the server, which knows the person by the session of their passkey,
 * sends them straight back with a code. The tokens live in memory only; the verifier and the state
 * wait in session storage across the redirect, and are dropped once they are used.
 */

/** What `/admin/config.json` says about the admin's client. */
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
  /** When the access token expires, in milliseconds since the epoch. */
  readonly expiresAt: number
}

/** What waits in session storage while the person is away at `/authorize`. */
interface Pending {
  readonly verifier: string
  readonly state: string
  /** Where to go back to in the admin once signed in. */
  readonly returnTo: string
}

export interface AuthDeps {
  readonly fetch: typeof fetch
  /** Leaves the page for another URL. */
  readonly navigate: (url: string) => void
  readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  readonly now: () => number
  /** The texts of a failed sign-in, in the admin's language; English if not given. */
  readonly text?: () => Messages['auth']
}

const PENDING = 'hollware:sign-in'
/** The site the person chose in the admin, for the next sign-in; none means the server's choice. */
const SITE = 'hollware:site'

/** Where the server ends the session of this browser's cookie, which only `/authorize…` gets. */
const SIGN_OUT = '/authorize/signout'

/** An access token is renewed when it has less than this left. */
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
    /** Sends the person to sign in, and back to `returnTo` in the admin afterwards. */
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

    /**
     * Moves the admin to another site of the person: a token is for one site, so the admin forgets
     * its tokens and signs in again for that site, which the server answers at once.
     */
    async switchSite(site: string, returnTo: string): Promise<void> {
      deps.storage.setItem(SITE, site)
      tokens = null
      await this.signIn(returnTo)
    },

    /**
     * Finishes the sign-in on the callback: checks the state, trades the code for tokens, and
     * answers where to go back to. The pending sign-in is used once.
     */
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

    /** An access token that is good for a minute more, renewed if need be, or `null`. */
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

    /** Forgets the tokens: the next call signs in again. */
    forget(): void {
      tokens = null
    },

    /**
     * Signs this browser out: the admin's grant ends with its refresh token (RFC 7009, at the token
     * endpoint), the session of the passkey ends with its cookie (`/authorize/signout`), the tokens
     * are forgotten, and the person lands on the sign-in page, which brings them back to the admin.
     * The two requests may fail: the tokens are forgotten and the person leaves all the same.
     */
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
