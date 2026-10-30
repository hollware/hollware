import { describe, expect, it } from 'vitest'

import type { HollwareRpc } from '../../src/index.ts'
import { boot, SITE_KEY } from '../http/support.ts'
import { CANNED } from '../mcp/support.ts'
import { CALLS } from './support.ts'

function callableNames(prototype: object | null): string[] {
  const names: string[] = []
  for (
    let current = prototype;
    current !== null && current !== Object.prototype;
    current = Object.getPrototypeOf(current)
  ) {
    names.push(...Object.getOwnPropertyNames(current).filter((name) => name !== 'constructor'))
  }
  return names.sort()
}

const RPC_METHODS: Record<keyof HollwareRpc, true> = {
  describeSite: true,
  getEntry: true,
  getNavigation: true,
  getTranslations: true,
  listEntries: true,
  listRedirects: true,
  search: true,
}

describe('the Hollware class', () => {
  it('has the seven methods of HollwareRpc and nothing else, own or inherited', () => {
    const { worker } = boot()

    expect(callableNames(worker.Hollware.prototype)).toEqual([
      'describeSite',
      'getEntry',
      'getNavigation',
      'getTranslations',
      'listEntries',
      'listRedirects',
      'search',
    ])
    expect(Object.keys(RPC_METHODS).sort()).toEqual([
      'describeSite',
      'getEntry',
      'getNavigation',
      'getTranslations',
      'listEntries',
      'listRedirects',
      'search',
    ])
  })

  it('holds only what a WorkerEntrypoint gets from the runtime', () => {
    const { worker, ctx, env } = boot()

    const instance = new worker.Hollware(ctx, env)

    expect(Object.getOwnPropertyNames(instance).sort()).toEqual(['ctx', 'env'])
  })

  it.each(CALLS)(
    '$method hands its arguments to $tool and answers its output, over the environment, the site and the clock of the Worker',
    async ({ call, tool, input, output }) => {
      const { worker, ctx, env, seen, sessions, clock, ready } = boot()
      await ready()
      const instance = new worker.Hollware(ctx, env)

      const answer = await call(instance)

      expect(answer).toEqual(output)
      expect(seen.map((one) => one.tool)).toEqual([tool])
      expect(seen[0]?.input).toStrictEqual(input)
      expect(seen[0]?.context.view).toBe('published')
      expect(seen[0]?.context.site.key).toBe(SITE_KEY)
      expect(seen[0]?.context.clock).toBe(clock)
      expect(sessions).toEqual(['first-unconstrained'])
    },
  )

  it('opens a session for each call, and never shares one between two', async () => {
    const { worker, ctx, env, sessions, ready } = boot()
    await ready()
    const instance = new worker.Hollware(ctx, env)

    await instance.describeSite(SITE_KEY)
    await instance.getTranslations(SITE_KEY, 'blog', 'hello')

    expect(sessions).toEqual(['first-unconstrained', 'first-unconstrained'])
  })

  it('is a class the Worker of the user extends, by the name it exports', async () => {
    const { worker, ctx, env, ready } = boot()
    await ready()
    class Hollware extends worker.Hollware {}

    const instance = new Hollware(ctx, env)

    expect(worker.Hollware.name).toBe('Hollware')
    expect(instance).toBeInstanceOf(worker.Hollware)
    expect(await instance.describeSite(SITE_KEY)).toEqual(CANNED.describe_site.ok)
  })
})
