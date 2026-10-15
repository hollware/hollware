import { expect, it } from 'vite-plus/test'

import { ApiError, createApi } from '../app/lib/api.ts'
import type { Auth } from '../app/lib/auth.ts'

// Fails when: the admin's calls (app/lib/api.ts) stop going to /v1/ops/{name} and /v1/admin/{path}
// with the access token as a Bearer header; a 401 stops sending the person to sign in again, back
// to where they were; or an answer in words stops arriving as an ApiError with its code and fix.

function world(answer: () => Response) {
  const sent: { url: string; method: string; authorization: string | null; body: string }[] = []
  const signIns: string[] = []
  let forgotten = false
  const auth: Auth = {
    signIn: async (returnTo) => void signIns.push(returnTo),
    complete: async () => '/',
    token: async () => 'access-1',
    forget: () => {
      forgotten = true
    },
  }
  const api = createApi({
    fetch: async (input, init) => {
      sent.push({
        url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        method: init?.method ?? 'GET',
        authorization: new Headers(init?.headers).get('authorization'),
        body: typeof init?.body === 'string' ? init.body : '',
      })
      return answer()
    },
    auth,
    here: () => '/admin/reviews',
  })
  return { api, sent, signIns, forgotten: () => forgotten }
}

it('calls an operation and an admin route with the token', async () => {
  const w = world(() => Response.json({ outcome: 'ok', reviews: [] }))

  await w.api.call('list_reviews', { status: 'pending' })
  await w.api.admin('tokens')
  await w.api.admin('invitations', { role: 'author' })

  expect(w.sent).toEqual([
    {
      url: '/v1/ops/list_reviews',
      method: 'POST',
      authorization: 'Bearer access-1',
      body: '{"status":"pending"}',
    },
    { url: '/v1/admin/tokens', method: 'GET', authorization: 'Bearer access-1', body: '' },
    {
      url: '/v1/admin/invitations',
      method: 'POST',
      authorization: 'Bearer access-1',
      body: '{"role":"author"}',
    },
  ])
})

it('sends the person to sign in again on a 401, back to where they were', async () => {
  const w = world(() => new Response(null, { status: 401 }))

  void w.api.admin('tokens')
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(w.forgotten()).toBe(true)
  expect(w.signIns).toEqual(['/admin/reviews'])
})

it('answers an error in words as an ApiError, with its code and its fix', async () => {
  const w = world(() =>
    Response.json(
      { code: 'forbidden', message: 'Only the admin may do this.', fix: 'Sign in.' },
      { status: 403 },
    ),
  )

  await expect(w.api.admin('tokens')).rejects.toEqual(
    new ApiError('forbidden', 'Only the admin may do this.', 'Sign in.'),
  )
  await expect(w.api.admin('tokens')).rejects.toMatchObject({ code: 'forbidden', fix: 'Sign in.' })
})
