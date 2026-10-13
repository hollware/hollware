import { describe, expect, it } from 'vitest'

import type { HollwareRpc } from '../../src/index.ts'
import { boot, SITE_KEY } from '../http/support.ts'
import { CANNED } from '../mcp/support.ts'
import { CALLS } from './support.ts'

// Fails when: the class a site reaches over a service binding (`Hollware`, `src/rpc/entrypoint.ts`)
// stops being exactly the four methods of `HollwareRpc`: a fifth public member on it or on what it
// inherits (anything on the prototype is callable by a Worker with the binding, and a writing
// method must never be), or one of the four missing; stops handing each call to the operation of
// its name with its arguments in the right order, over the environment the class was built with;
// opens one session for several calls (a session is for one call); or stops being a class that the
// user's Worker can extend as `export class Hollware extends hollware.Hollware {}`. The class is
// instantiated here by hand; a real service binding is the playground harness's test.

/**
 * Every name a Worker with the binding could call: own and inherited, up to `Object.prototype`.
 * Names are strings, which is all a call over RPC can name; the runtime's own symbols are not.
 */
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

/** The methods of `HollwareRpc`: a key added to or taken from the interface is a type error here. */
const RPC_METHODS: Record<keyof HollwareRpc, true> = {
  describeSite: true,
  getEntry: true,
  getTranslations: true,
  listEntries: true,
}

describe('the Hollware class', () => {
  it('has the four methods of HollwareRpc and nothing else, own or inherited', () => {
    const { worker } = boot()

    expect(callableNames(worker.Hollware.prototype)).toEqual([
      'describeSite',
      'getEntry',
      'getTranslations',
      'listEntries',
    ])
    expect(Object.keys(RPC_METHODS).sort()).toEqual([
      'describeSite',
      'getEntry',
      'getTranslations',
      'listEntries',
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
      const { worker, ctx, env, seen, sessions, clock } = boot()
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
    const { worker, ctx, env, sessions } = boot()
    const instance = new worker.Hollware(ctx, env)

    await instance.describeSite(SITE_KEY)
    await instance.getTranslations(SITE_KEY, 'blog', 'hello')

    expect(sessions).toEqual(['first-unconstrained', 'first-unconstrained'])
  })

  it('is a class the Worker of the user extends, by the name it exports', async () => {
    const { worker, ctx, env } = boot()
    class Hollware extends worker.Hollware {}

    const instance = new Hollware(ctx, env)

    expect(worker.Hollware.name).toBe('Hollware')
    expect(instance).toBeInstanceOf(worker.Hollware)
    expect(await instance.describeSite(SITE_KEY)).toEqual(CANNED.describe_site.ok)
  })
})
