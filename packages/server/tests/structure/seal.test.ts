import { describe, expect, it } from 'vite-plus/test'

import { newWebhookSecret, openSealed, seal, unseal } from '../../src/structure/seal.ts'

// Fails when: a secret sealed under HOLLWARE_SECRET (src/structure/seal.ts) stops opening under the
// same one at the same site and name, opens under another, once tampered with, or moved to
// another site or name, holds the value in clear, seals the same value twice to the same
// text, or takes a HOLLWARE_SECRET under 32 characters; or stops opening a `v1.` value, sealed
// before the place was bound, or stops sealing one again as `v2.` when openSealed reads it; or a webhook secret stops being 32 random bytes in hex.

const MASTER = 'm'.repeat(48)
const HERE = { site: 'blog', name: 'webhook:site' }

describe('seal', () => {
  it('opens under the same secret, and under no other, nor tampered with', async () => {
    const sealed = await seal(MASTER, 'whsec_abc', HERE)

    expect(sealed.startsWith('v2.')).toBe(true)
    expect(sealed).not.toContain('whsec_abc')
    expect(await unseal(MASTER, sealed, HERE)).toBe('whsec_abc')
    expect(await unseal('n'.repeat(48), sealed, HERE)).toBeNull()
    const flipped = `${sealed.slice(0, -2)}${sealed.at(-2) === 'A' ? 'B' : 'A'}${sealed.at(-1)}`
    expect(await unseal(MASTER, flipped, HERE)).toBeNull()
    expect(await seal(MASTER, 'whsec_abc', HERE)).not.toBe(sealed)
  })

  it('opens only where it was sealed: another site or name does not open it', async () => {
    const sealed = await seal(MASTER, 'whsec_abc', HERE)

    expect(await unseal(MASTER, sealed, { site: 'docs', name: 'webhook:site' })).toBeNull()
    expect(await unseal(MASTER, sealed, { site: 'blog', name: 'webhook:other' })).toBeNull()
  })

  it('still opens a v1 value, sealed before the place was bound, wherever it is', async () => {
    // Sealed by 0.8 to 0.10, with no associated data: AES-GCM under SHA-256 of the master.
    const key = await crypto.subtle.importKey(
      'raw',
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(MASTER)),
      'AES-GCM',
      false,
      ['encrypt'],
    )
    const nonce = new Uint8Array(12)
    const cipher = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: nonce },
        key,
        new TextEncoder().encode('whsec_old'),
      ),
    )
    const bytes = new Uint8Array([...nonce, ...cipher])
    const v1 = `v1.${btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')}`

    expect(await unseal(MASTER, v1, HERE)).toBe('whsec_old')

    // Read through openSealed, it is written back bound to its place, and opens nowhere else.
    const written: string[] = []
    const opened = await openSealed(MASTER, v1, HERE, async (resealed) => {
      written.push(resealed)
    })
    const [resealed = ''] = written
    expect([opened, resealed.slice(0, 3), await unseal(MASTER, resealed, HERE)]).toEqual([
      'whsec_old',
      'v2.',
      'whsec_old',
    ])
    expect(await unseal(MASTER, resealed, { site: 'docs', name: 'webhook:site' })).toBeNull()
    // A v2 value is left as it is.
    const kept: string[] = []
    await openSealed(MASTER, resealed, HERE, async (again) => {
      kept.push(again)
    })
    expect(kept).toEqual([])
  })

  it('refuses a HOLLWARE_SECRET that is too short to be one', async () => {
    await expect(seal('short', 'x', HERE)).rejects.toThrow('shorter than 32 characters')
  })

  it('makes webhook secrets of 32 random bytes', () => {
    const [one, two] = [newWebhookSecret(), newWebhookSecret()]
    expect(one).toMatch(/^whsec_[0-9a-f]{64}$/)
    expect(one).not.toBe(two)
  })
})
