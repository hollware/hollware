import { expect, it } from 'vitest'

import worker from '../../src/index.ts'

it('exports the fetch, queue and scheduled handlers of Hollware', () => {
  expect(Object.keys(worker).sort()).toEqual(['fetch', 'queue', 'scheduled'])
})
