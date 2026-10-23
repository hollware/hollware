import { describe, expect, it } from 'vite-plus/test'

import { retryingLostConnection } from './workers.ts'

const lost = () => new Response('Error: Network connection lost.\n    at fetch', { status: 500 })

function sender(...answers: Response[]) {
  let sent = 0
  return {
    send: async () => answers[sent++] ?? new Response('no more answers', { status: 599 }),
    count: () => sent,
  }
}

describe('a request whose connection miniflare lost', () => {
  it('is sent once more, and says so', async () => {
    const { send, count } = sender(lost(), new Response('ok', { status: 401 }))
    const said: string[] = []

    const answer = await retryingLostConnection(send, (message) => said.push(message))

    expect([answer.status, count(), said.length]).toEqual([401, 2, 1])
  })

  it('is not sent again when the Worker answered, even with a 500 of its own', async () => {
    const own = sender(new Response('{"code":"internal"}', { status: 500 }))
    const fine = sender(new Response('ok', { status: 200 }))

    expect([
      (await retryingLostConnection(own.send, () => {})).status,
      own.count(),
      (await retryingLostConnection(fine.send, () => {})).status,
      fine.count(),
    ]).toEqual([500, 1, 200, 1])
  })

  it('is sent once more at most', async () => {
    const { send, count } = sender(lost(), lost(), new Response('ok'))

    const answer = await retryingLostConnection(send, () => {})

    expect([answer.status, count()]).toEqual([500, 2])
  })
})
