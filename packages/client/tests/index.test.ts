import { expect, it } from 'vite-plus/test'

import { createClient, HollwareClientError, name } from '../src/index.ts'

it('exports the package name', () => {
  expect(name).toBe('@hollware/client')
})

function overHttp(status: number, body: unknown) {
  const sent: Request[] = []
  const reader = createClient({
    url: 'https://cms.test/',
    token: 'hw_read_token',
    fetch: async (request) => {
      sent.push(request)
      return new Response(JSON.stringify(body), { status })
    },
  })
  return { reader, sent }
}

const NAVIGATION = {
  outcome: 'ok',
  collection: 'my docs',
  locale: 'es',
  groups: [{ name: null, entries: [] }],
}

it('reads a navigation over HTTP from /v1/<collection>/navigation, with the locale and the token', async () => {
  const { reader, sent } = overHttp(200, NAVIGATION)

  const answer = await reader.getNavigation('site', 'my docs', { locale: 'es' })
  await reader.getNavigation('site', 'my docs')

  expect(answer).toEqual(NAVIGATION)
  expect(sent.map((request) => request.url)).toEqual([
    'https://cms.test/v1/my%20docs/navigation?locale=es',
    'https://cms.test/v1/my%20docs/navigation',
  ])
  expect(sent[0]?.headers.get('authorization')).toBe('Bearer hw_read_token')
})

it('turns a refused navigation into an error with its code and fix', async () => {
  const { reader } = overHttp(422, { code: 'output_too_large', message: 'Too many.', fix: 'Page.' })

  const refused = await reader.getNavigation('site', 'docs').then(
    () => null,
    (error: unknown) => error,
  )

  expect(refused).toBeInstanceOf(HollwareClientError)
  expect(refused).toMatchObject({ status: 422, code: 'output_too_large', fix: 'Page.' })
})
