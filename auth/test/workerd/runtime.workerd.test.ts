import { describe, expect, it } from 'vitest'

// What the Vitest pool's isolate is, so that nobody reads "it passes in workerd" as "it passes
// without Node.js compatibility".
//
// Fails when: @cloudflare/vitest-plugin stops switching Node.js compatibility on for the test
// isolate (then the caveat in ceremony.workerd.test.ts can go, and these tests should become the
// opposite assertion), or the runtime stops being workerd.
//
// wrangler.jsonc opts out of both nodejs_compat and nodejs_compat_v2, and the built Worker really has
// no process and no Buffer (scripts/e2e-built-worker.ts asserts it against plain workerd). The pool
// puts them back: the Vitest runner needs node:fs, node:tty and friends inside the isolate.
const scope: Record<string, unknown> = globalThis

describe('the Vitest pool isolate', () => {
  it('is workerd', () => {
    expect(navigator.userAgent).toBe('Cloudflare-Workers')
  })

  it('has Node.js globals although wrangler.jsonc opts out of them', () => {
    expect(typeof scope.process).toBe('object')
    expect(typeof scope.Buffer).toBe('function')
  })

  it('can import node: modules although wrangler.jsonc opts out of them', async () => {
    // The types generated for a Worker without nodejs_compat do not declare node: modules, so the
    // same import in src/ would fail `tsc`: a guard on its own (see the report).
    // @ts-expect-error node:crypto has no declaration in this type environment
    const nodeCrypto: { randomBytes: unknown } = await import('node:crypto')

    expect(typeof nodeCrypto.randomBytes).toBe('function')
  })
})
