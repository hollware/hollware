import { exports } from 'cloudflare:workers'
import { expect, it } from 'vitest'

// Fails when: @cloudflare/vitest-plugin stops turning Node.js compatibility on in its test runner
// even though wrangler.jsonc opts out of it. Then a workerd test could prove "no Node.js" and
// the warning in AGENTS.md can go; until then only the built Worker (test/harness) can.

it('has the Node.js globals in the test runner, whatever wrangler.jsonc says', async () => {
  expect(await exports.Playground.nodeGlobals()).toEqual(['process', 'Buffer', 'setImmediate'])
})
