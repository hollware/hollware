import { verifySignature } from '@simplewebauthn/server/helpers'
import { describe, expect, it } from 'vitest'
import { ES256_COSE_PUBLIC_KEY_HEX, ES256_PRIVATE_JWK, toHex } from '../support/fixtures.ts'
import { ecdsaRawToDer, SoftwareAuthenticator } from '../support/software-authenticator.ts'

// The test double is a test subject too: a bug in it would let a broken verifier pass, or fail a
// good one, and nobody would know which side was wrong.
//
// Fails when: ecdsaRawToDer stops stripping leading zeros or stops adding the 0x00 in front of an
// integer with the high bit set, or produces a DER the library's parser refuses, or the fixed key
// stops giving the COSE_Key written by hand in fixtures.ts.

const bytes = (...parts: [value: number, count: number][]): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(parts.flatMap(([value, count]) => Array<number>(count).fill(value)))

const hex = (...parts: [value: number, count: number][]): string => toHex(bytes(...parts))

describe('ecdsaRawToDer', () => {
  it.each([
    {
      case: 'r = 1 (31 zero bytes dropped), s with the high bit set (a 0x00 added)',
      raw: bytes([0, 31], [1, 1], [0x80, 1], [0, 31]),
      // 30 26: SEQUENCE of 38 bytes. 02 01 01: r. 02 21 00 80 00..: s, 33 bytes with the 0x00 in front.
      der: '3026' + '020101' + '022100' + '80' + hex([0, 31]),
    },
    {
      case: 'r = 0 is the single byte 00, s starts below 0x80 and gets no padding',
      raw: bytes([0, 32], [0x7f, 1], [0xff, 31]),
      der: '3025' + '020100' + '0220' + '7f' + hex([0xff, 31]),
    },
    {
      case: 'r with two leading zero bytes and then the high bit set',
      raw: bytes([0, 2], [0xaa, 1], [0xbb, 29], [0x11, 32]),
      // 02 1f: 31 bytes = the 0x00 added in front of aa + 29 x bb + aa itself (1 + 1 + 29).
      der: '3043' + '021f' + '00' + 'aa' + hex([0xbb, 29]) + '0220' + hex([0x11, 32]),
    },
  ])('encodes $case', ({ raw, der }) => {
    expect(toHex(ecdsaRawToDer(raw))).toBe(der)
  })

  it.each([
    { name: 'an odd length', raw: new Uint8Array(63) },
    { name: 'no bytes', raw: new Uint8Array(0) },
  ])('refuses $name', ({ raw }) => {
    expect(() => ecdsaRawToDer(raw)).toThrow(
      `An ECDSA raw signature has an even, non-zero length, got ${raw.length}`,
    )
  })

  it('gives a DER the library parses, for the three shapes above (it does not throw)', async () => {
    const credentialPublicKey = (
      await SoftwareAuthenticator.create({
        credentialId: new Uint8Array(16),
        privateJwk: ES256_PRIVATE_JWK,
      })
    ).cosePublicKey
    const raws = [
      bytes([0, 31], [1, 1], [0x80, 1], [0, 31]),
      bytes([0, 32], [0x7f, 1], [0xff, 31]),
      bytes([0, 2], [0xaa, 1], [0xbb, 29], [0x11, 32]),
    ]
    for (const raw of raws) {
      // Not a real signature, so the answer is false; a DER the parser refuses would throw instead.
      expect(
        await verifySignature({
          signature: ecdsaRawToDer(raw),
          data: Uint8Array.of(1, 2, 3),
          credentialPublicKey,
        }),
      ).toBe(false)
    }
  })

  it('produces a DER the library accepts for 300 real signatures', async () => {
    const authenticator = await SoftwareAuthenticator.create({
      credentialId: new Uint8Array(16),
      privateJwk: ES256_PRIVATE_JWK,
    })
    const key = await crypto.subtle.importKey(
      'jwk',
      ES256_PRIVATE_JWK,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    )

    let verified = 0
    for (let index = 0; index < 300; index++) {
      const data = Uint8Array.of(index & 0xff, index >> 8)
      const raw = new Uint8Array(
        await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, data),
      )
      const ok = await verifySignature({
        signature: ecdsaRawToDer(raw),
        data,
        credentialPublicKey: authenticator.cosePublicKey,
      })
      if (ok) verified++
    }

    expect(verified).toBe(300)
  })
})

describe('SoftwareAuthenticator', () => {
  it('encodes the fixed ES256 key as the COSE_Key written by hand', async () => {
    const authenticator = await SoftwareAuthenticator.create({
      credentialId: new Uint8Array(16),
      privateJwk: ES256_PRIVATE_JWK,
    })

    expect(toHex(authenticator.cosePublicKey)).toBe(ES256_COSE_PUBLIC_KEY_HEX)
  })

  it('reports SPKI of 91 bytes for P-256: 26 bytes of header and the 65-byte point', async () => {
    const authenticator = await SoftwareAuthenticator.create({
      credentialId: new Uint8Array(16),
      privateJwk: ES256_PRIVATE_JWK,
    })

    expect(authenticator.spki.length).toBe(91)
    // 30 59 30 13 06 07 2a8648ce3d0201 06 08 2a8648ce3d030107 03 42 00 04: SPKI of an EC P-256 key.
    expect(toHex(authenticator.spki.subarray(0, 27))).toBe(
      '3059301306072a8648ce3d020106082a8648ce3d030107034200'.concat('04'),
    )
  })

  it('refuses a BS flag without BE', async () => {
    await expect(
      SoftwareAuthenticator.create({ credentialId: new Uint8Array(16), backedUp: true }),
    ).rejects.toThrow('BS without BE is invalid: a single-device credential cannot be backed up')
  })
})
