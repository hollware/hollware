import { describe, expect, it } from 'vite-plus/test'

import { canRemoveLast, enrollPasskey } from '../app/lib/passkeys.ts'

describe('adding a passkey to the account', () => {
  it('asks for options, creates the credential with them, and sends it with the label', async () => {
    const calls: [string, unknown][] = []
    const added = await enrollPasskey(
      {
        admin: async (path, body) => {
          calls.push([path, body])
          return path === 'account/passkeys/options'
            ? { challengeId: 'chl_1', options: { challenge: 'c' } }
            : { id: 'pky_1' }
        },
        create: async (options) => ({ made: options }),
      },
      ' Phone ',
    )

    expect(added).toBe('pky_1')
    expect(calls).toEqual([
      ['account/passkeys/options', {}],
      [
        'account/passkeys/verify',
        { challengeId: 'chl_1', response: { made: { challenge: 'c' } }, label: 'Phone' },
      ],
    ])
  })

  it('lets the last passkey go only when an account of a provider signs the person in', () => {
    expect([canRemoveLast(1, 0), canRemoveLast(2, 0), canRemoveLast(1, 1)]).toEqual([
      false,
      true,
      true,
    ])
  })
})
