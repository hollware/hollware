import { expect, it } from 'vitest'

import worker from '../../src/index.ts'

// Fails when: the playground's module stops exporting a handler that Hollware needs from a
// project: fetch (the gateway), scheduled (the cron trigger of ADR-025) and queue (the consumer of
// the events Queue). Cloudflare refuses to attach a Queue consumer to a Worker without `queue`.

it('exports the fetch, queue and scheduled handlers of Hollware', () => {
  expect(Object.keys(worker).sort()).toEqual(['fetch', 'queue', 'scheduled'])
})
