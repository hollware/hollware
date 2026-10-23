import { describe, expect, it } from 'vite-plus/test'

import { makePreviewToken, verifyPreviewToken } from '../src/preview.ts'

const SECRET = 's'.repeat(32)
const SITE = 'playground'
const ENTRY = 'ent_01'
const NOW = new Date(1_760_000_000_000)

const TOKEN =
  'hw_prv_eyJzIjoicGxheWdyb3VuZCIsImUiOiJlbnRfMDEiLCJ4IjoxNzYwMDAzNjAwfQ.nVLhIGX_NQm0tpYSnlpVHXYQMHCSWlmMu2_z7xHlWws'

const check = (token: string, at = NOW, site = SITE, secret: string | null = SECRET) =>
  verifyPreviewToken({ secret: secret ?? undefined, site, token, now: at })

describe('preview tokens', () => {
  it('are made as the design says, for one hour', async () => {
    expect(
      await makePreviewToken({ secret: SECRET, site: SITE, entryId: ENTRY, now: NOW }),
    ).toEqual({ token: TOKEN, expiresAt: '2025-10-09T09:53:20.000Z' })
  })

  it('verify for their site, naming the entry, until the second they expire', async () => {
    expect(await check(TOKEN)).toEqual({
      ok: true,
      entryId: ENTRY,
      expiresAt: '2025-10-09T09:53:20.000Z',
    })
    expect(await check(TOKEN, new Date(1_760_003_599_000))).toMatchObject({ ok: true })
    expect(await check(TOKEN, new Date(1_760_003_600_000))).toEqual({
      ok: false,
      reason: 'expired',
    })
  })

  it('are refused for another site', async () => {
    expect(await check(TOKEN, NOW, 'other')).toEqual({ ok: false, reason: 'signature' })
  })

  it('are refused under another secret', async () => {
    expect(await check(TOKEN, NOW, SITE, 't'.repeat(32))).toEqual({
      ok: false,
      reason: 'signature',
    })
  })

  it('are refused when the payload or the signature is changed', async () => {
    const [head = '', signature = ''] = TOKEN.split('.')
    const other = await makePreviewToken({
      secret: SECRET,
      site: SITE,
      entryId: 'ent_02',
      now: NOW,
    })
    const otherPayload = other.token.split('.')[0]
    const flipped = `${signature.slice(0, -2)}${signature.endsWith('AA') ? 'BB' : 'AA'}`

    expect(await check(`${otherPayload}.${signature}`)).toEqual({ ok: false, reason: 'signature' })
    expect(await check(`${head}.${flipped}`)).toEqual({ ok: false, reason: 'signature' })
  })

  it('are refused when they are not tokens', async () => {
    const verdicts = await Promise.all(
      [
        '',
        'hw_prv_',
        'hw_prv_abc',
        'hw_prv_a.b.c',
        `${TOKEN}.x`,
        TOKEN.slice(7),
        'hw_prv_!!.??',
      ].map(async (token) => (await check(token)).ok),
    )
    expect(verdicts).toEqual([false, false, false, false, false, false, false])
    expect(await check('hw_prv_abc')).toEqual({ ok: false, reason: 'malformed' })
  })

  it('are neither made nor accepted without a secret of 32 characters', async () => {
    expect(await check(TOKEN, NOW, SITE, null)).toEqual({ ok: false, reason: 'no_secret' })
    expect(await check(TOKEN, NOW, SITE, 's'.repeat(31))).toEqual({
      ok: false,
      reason: 'no_secret',
    })
    await expect(
      makePreviewToken({ secret: 's'.repeat(31), site: SITE, entryId: ENTRY, now: NOW }),
    ).rejects.toThrow('HOLLWARE_SECRET must be at least 32 characters.')
  })
})
