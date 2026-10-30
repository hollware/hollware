import { describe, expect, it } from 'vite-plus/test'

import { createOpsClient } from '../src/index.ts'

const TOKEN = 'hw_pat_0123456789abcdefghjkmnpqrstvwxyz0123456789abcdefgh'

describe('createOpsClient', () => {
  it('calls the operation over the binding as its token, and answers what the binding answers', async () => {
    const calls: unknown[][] = []
    const saved = { outcome: 'pending_review' }
    const client = createOpsClient({
      binding: {
        ops: async (...args: unknown[]) => {
          calls.push(args)
          return saved
        },
      },
      token: TOKEN,
    })

    const answer = await client.call('request_review', {
      id: 'ent_01J9ZQ3X5V7K2M4N6P8R0T1W3Y',
      version: 2,
    })

    expect(answer).toBe(saved)
    expect(calls).toEqual([
      ['request_review', { id: 'ent_01J9ZQ3X5V7K2M4N6P8R0T1W3Y', version: 2 }, { token: TOKEN }],
    ])
  })

  it('names a binding that is not one to HollwareOps', () => {
    expect(() => createOpsClient({ binding: { getEntry: () => null }, token: TOKEN })).toThrow(
      'Hollware: the binding is no service binding to the HollwareOps entrypoint',
    )
  })
})
