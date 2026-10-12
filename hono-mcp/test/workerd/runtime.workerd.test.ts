import { describe, expect, it } from 'vitest'

// Fails when: @cloudflare/vitest-plugin stops turning Node.js compatibility on for its test runner. Today
// it forces nodejs_compat_v2 even when wrangler.jsonc says no_nodejs_compat / no_nodejs_compat_v2, so
// `process`, `Buffer` and `setImmediate` exist in every *.workerd.test.ts. A test in this runner can
// therefore never prove "works without Node": that proof is test/node/http.node.test.ts against the
// BUILT Worker in a real workerd. If this test starts failing, the runner can prove it and that check
// becomes redundant.

describe('the vitest workerd runner', () => {
  it('has the Node.js globals the Worker itself does not have', () => {
    const globals: Record<string, unknown> = globalThis

    expect(typeof globals.process).toBe('object')
    expect(typeof globals.Buffer).toBe('function')
    expect(typeof globals.setImmediate).toBe('function')
  })
})
