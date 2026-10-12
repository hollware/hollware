import { describe, expect, it } from 'vitest'

// Fails when: @cloudflare/vitest-plugin stops forcing Node.js compatibility on for its runner. The
// wrangler.jsonc of this app sets BOTH `no_nodejs_compat` and `no_nodejs_compat_v2`, and the plugin
// removes `no_nodejs_compat_v2` from the runner Worker, which then gets the default-on Node.js
// modules of compatibility date 2026-10-06. Today that means the vitest pool CANNOT prove "works
// without nodejs_compat" (the tests in this folder pass with Node on); test/node/built-worker.test.ts
// does, in a real workerd. If this test starts failing, the pool can run without Node.js
// compatibility and the claim in the other tests' headers can be dropped.

describe('the vitest pool with no_nodejs_compat and no_nodejs_compat_v2 in the wrangler config', () => {
  it('still runs the tests with the Node.js globals and modules on', async () => {
    const specifier = ['node', 'fs'].join(':')

    expect(navigator.userAgent).toBe('Cloudflare-Workers')
    expect(Reflect.has(globalThis, 'process')).toBe(true)
    expect(Reflect.has(globalThis, 'Buffer')).toBe(true)
    expect(typeof (await import(/* @vite-ignore */ specifier))).toBe('object')
  })
})
