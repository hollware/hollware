import { describe, expect, it } from 'vite-plus/test'

import {
  ASK_TIMEOUT_MS,
  FRESH_MS,
  LATEST_RELEASE_URL,
  MAX_RELEASE_BYTES,
  RETRY_MS,
  isNewer,
  latestRelease,
  type Fetch,
} from '../../src/http/release.ts'

function registry(answers: (() => Response)[]): { fetcher: Fetch; asked: string[] } {
  const asked: string[] = []
  const fetcher: Fetch = async (input) => {
    asked.push(input)
    const next = answers.shift()
    if (next === undefined) throw new Error('offline')
    return next()
  }
  return { fetcher, asked }
}

const release = (version: string) => () => Response.json({ name: 'hollware', version })

describe('a newer release', () => {
  it.each([
    ['1.8.0', '1.7.0', true],
    ['2.0.0', '1.12.3', true],
    ['1.7.1', '1.7.0', true],
    ['1.10.0', '1.9.0', true],
    ['1.7.0', '1.7.0', false],
    ['1.6.9', '1.7.0', false],
    ['1.7.0', '1.7.0-rc.2', true],
    ['1.7.0-rc.3', '1.7.0-rc.2', true],
    ['1.7.0-rc.10', '1.7.0-rc.9', true],
    ['1.7.0-rc.2', '1.7.0', false],
    ['1.7.0-rc.2', '1.7.0-rc.2', false],
    ['1.7.0-rc.2.1', '1.7.0-rc.2', true],
    ['1.7.0-rc.2', '1.7.0-rc.2.1', false],
    ['1.7.0-rc', '1.7.0-2', true],
    ['latest', '1.7.0', false],
  ])('%s over %s: %s', (candidate, installed, expected) => {
    expect(isNewer(candidate, installed)).toBe(expected)
  })
})

describe('the latest release of Hollware', () => {
  it('is the version npm tags latest, asked once while it is fresh', async () => {
    const { fetcher, asked } = registry([release('1.8.0'), release('1.9.0')])
    const latest = latestRelease(fetcher)

    const first = await latest(0)
    const fresh = await latest(FRESH_MS - 1)
    const stale = await latest(FRESH_MS)

    expect([first, fresh, stale]).toEqual(['1.8.0', '1.8.0', '1.9.0'])
    expect(asked).toEqual([LATEST_RELEASE_URL, LATEST_RELEASE_URL])
  })

  it('keeps the last version known while npm fails, and asks again after a while', async () => {
    const { fetcher, asked } = registry([
      release('1.8.0'),
      () => new Response('down', { status: 503 }),
      release('1.9.0'),
    ])
    const latest = latestRelease(fetcher)

    await latest(0)
    const failed = await latest(FRESH_MS)
    const waiting = await latest(FRESH_MS + RETRY_MS - 1)
    const again = await latest(FRESH_MS + RETRY_MS)

    expect([failed, waiting, again]).toEqual(['1.8.0', '1.8.0', '1.9.0'])
    expect(asked).toHaveLength(3)
  })

  it('is unknown when npm cannot be reached or answers something else', async () => {
    const answers = [
      () => {
        throw new TypeError('network')
      },
      () => new Response('<html>', { status: 200 }),
      () => Response.json({ version: '<script>' }),
      () => Response.json({ version: 7 }),
      () => Response.json({ version: '1.8.0' }, { status: 500 }),
      () => Response.json({ version: 'v1.8.0' }),
      () => Response.json({ version: '1.8.0 beta' }),
      () => Response.json(['1.8.0']),
    ]
    for (const answer of answers) {
      const latest = latestRelease(registry([answer]).fetcher)
      expect(await latest(0)).toBeNull()
    }
  })

  it('is unknown when npm does not answer in time', async () => {
    const silent: Fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
      })
    const started = Date.now()

    const latest = await latestRelease(silent)(0)

    expect(latest).toBeNull()
    expect(Date.now() - started).toBeGreaterThanOrEqual(ASK_TIMEOUT_MS - 50)
  })

  it('reads no more than a small answer', async () => {
    const padding = 'x'.repeat(MAX_RELEASE_BYTES)
    const streamed = latestRelease(
      registry([
        () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(
                  new TextEncoder().encode(JSON.stringify({ version: '1.8.0', padding })),
                )
                controller.close()
              },
            }),
          ),
      ]).fetcher,
    )
    const small = latestRelease(
      registry([() => Response.json({ version: '1.8.0', padding: 'x'.repeat(1000) })]).fetcher,
    )

    expect(await streamed(0)).toBeNull()
    expect(await small(0)).toBe('1.8.0')
  })
})
