import { describe, expect, it } from 'vite-plus/test'

import { newWebhookSecret, seal, unseal } from '../../src/structure/seal.ts'

// Fails when: a secret sealed under HOLLWARE_SECRET (src/structure/seal.ts) stops opening under the
// same one, opens under another or once tampered with, holds the value in clear, seals the same
// value twice to the same text, or takes a HOLLWARE_SECRET under 32 characters; or a webhook
// secret stops being 32 random bytes in hex.

const MASTER = 'm'.repeat(48)

describe('seal', () => {
  it('opens under the same secret, and under no other, nor tampered with', async () => {
    const sealed = await seal(MASTER, 'whsec_abc')

    expect(sealed.startsWith('v1.')).toBe(true)
    expect(sealed).not.toContain('whsec_abc')
    expect(await unseal(MASTER, sealed)).toBe('whsec_abc')
    expect(await unseal('n'.repeat(48), sealed)).toBeNull()
    const flipped = `${sealed.slice(0, -2)}${sealed.at(-2) === 'A' ? 'B' : 'A'}${sealed.at(-1)}`
    expect(await unseal(MASTER, flipped)).toBeNull()
    expect(await seal(MASTER, 'whsec_abc')).not.toBe(sealed)
  })

  it('refuses a HOLLWARE_SECRET that is too short to be one', async () => {
    await expect(seal('short', 'x')).rejects.toThrow('shorter than 32 characters')
  })

  it('makes webhook secrets of 32 random bytes', () => {
    const [one, two] = [newWebhookSecret(), newWebhookSecret()]
    expect(one).toMatch(/^whsec_[0-9a-f]{64}$/)
    expect(one).not.toBe(two)
  })
})
