import { describe, expect, it } from 'vite-plus/test'

import { createAuth, SignInError } from '../app/lib/auth.ts'
import { challengeOf } from '../app/lib/pkce.ts'

// Fails when: the admin's sign-in (app/lib/auth.ts) stops being the OAuth flow of ADR-026: it
// sends the person to /authorize with the admin's client, its redirect URI, the resource /v1, the
// scopes, a state and an S256 challenge; on the callback it refuses a state that is not the one it
// sent and uses a pending sign-in once; it trades the code with the verifier for tokens it keeps in
// memory only; it renews the access token with the refresh token a minute before it expires; and
// it forgets tokens the server no longer takes; or a switch of site stops forgetting the tokens of
// the last site and naming the new one at every sign-in.

const CONFIG = {
  issuer: 'https://cms.example.com',
  clientId: 'admin-client-id1',
  redirectUri: 'https://cms.example.com/admin/callback',
  resource: 'https://cms.example.com/v1',
  scope: 'content:read content:write content:publish schema:admin',
}

function world(tokenAnswers: Response[] = []) {
  const storage = new Map<string, string>()
  const posts: URLSearchParams[] = []
  const visited: string[] = []
  let now = 1_000_000
  const auth = createAuth({
    fetch: async (input, init) => {
      const target =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (target === '/admin/config.json') return Response.json(CONFIG)
      if (target === '/oauth/token') {
        posts.push(init?.body instanceof URLSearchParams ? init.body : new URLSearchParams())
        return tokenAnswers.shift() ?? new Response(null, { status: 400 })
      }
      throw new Error(`unexpected fetch of ${target}`)
    },
    navigate: (url) => void visited.push(url),
    storage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => void storage.set(key, value),
      removeItem: (key) => void storage.delete(key),
    },
    now: () => now,
  })
  return {
    auth,
    storage,
    posts,
    visited,
    later: (ms: number) => {
      now += ms
    },
  }
}

const tokens = (access: string, refresh = 'refresh-1') =>
  Response.json({ access_token: access, refresh_token: refresh, expires_in: 3600 })

/** Signs in, and answers the callback the server would send back. */
async function signedIn(w: ReturnType<typeof world>) {
  await w.auth.signIn('/admin/reviews')
  const sent = new URL(w.visited.at(-1) ?? '', CONFIG.issuer)
  const callback = new URL(
    `${CONFIG.redirectUri}?code=code-1&state=${sent.searchParams.get('state') ?? ''}`,
  )
  return { sent, back: await w.auth.complete(callback) }
}

describe('the sign-in of the admin', () => {
  it('goes to /authorize as the admin, with a state and an S256 challenge', async () => {
    const w = world([tokens('access-1')])

    const { sent, back } = await signedIn(w)

    expect(sent.pathname).toBe('/authorize')
    expect(Object.fromEntries(sent.searchParams)).toMatchObject({
      response_type: 'code',
      client_id: CONFIG.clientId,
      redirect_uri: CONFIG.redirectUri,
      scope: CONFIG.scope,
      resource: CONFIG.resource,
      code_challenge_method: 'S256',
    })
    const [post] = w.posts
    expect(post?.get('grant_type')).toBe('authorization_code')
    expect(sent.searchParams.get('code_challenge')).toBe(
      await challengeOf(post?.get('code_verifier') ?? ''),
    )
    expect(back).toBe('/admin/reviews')
    expect(await w.auth.token()).toBe('access-1')
    expect(w.storage.size).toBe(0)
  })

  it('names no site until the person switches to one, and then that site at every sign-in', async () => {
    const w = world([tokens('access-1')])
    await signedIn(w)

    await w.auth.switchSite('docs', '/admin/')
    const switched = new URL(w.visited.at(-1) ?? '', CONFIG.issuer)
    await w.auth.signIn('/admin/')
    const again = new URL(w.visited.at(-1) ?? '', CONFIG.issuer)

    expect(new URL(w.visited[0] ?? '', CONFIG.issuer).searchParams.has('site')).toBe(false)
    expect(switched.searchParams.get('site')).toBe('docs')
    expect(again.searchParams.get('site')).toBe('docs')
    expect(await w.auth.token()).toBe(null)
  })

  it('refuses a callback whose state is not the one it sent, and uses a sign-in once', async () => {
    const w = world([tokens('access-1')])
    await w.auth.signIn('/admin/')

    await expect(
      w.auth.complete(new URL(`${CONFIG.redirectUri}?code=code-1&state=forged`)),
    ).rejects.toBeInstanceOf(SignInError)
    await expect(
      w.auth.complete(new URL(`${CONFIG.redirectUri}?code=code-1&state=forged`)),
    ).rejects.toThrow('did not come back as it left')
    expect(w.posts).toEqual([])
  })

  it('renews the token a minute before it expires, and forgets one that cannot be renewed', async () => {
    const w = world([tokens('access-1'), tokens('access-2', 'refresh-2')])
    await signedIn(w)

    w.later(3600_000 - 61_000)
    expect(await w.auth.token()).toBe('access-1')
    w.later(2_000)
    expect(await w.auth.token()).toBe('access-2')
    expect(w.posts.at(-1)?.get('refresh_token')).toBe('refresh-1')
    w.later(3600_000)
    expect(await w.auth.token()).toBeNull()
  })
})
