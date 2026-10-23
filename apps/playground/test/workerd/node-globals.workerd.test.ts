import { exports } from 'cloudflare:workers'
import { expect, it } from 'vitest'

it('has the Node.js globals in the test runner, whatever wrangler.jsonc says', async () => {
  expect(await exports.Probe.nodeGlobals()).toEqual(['process', 'Buffer', 'setImmediate'])
})
