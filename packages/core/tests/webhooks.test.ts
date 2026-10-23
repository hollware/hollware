import { describe, expect, it } from 'vite-plus/test'

import { signWebhook, verifyWebhook } from '../src/webhooks.ts'

// Fails when: src/webhooks.ts stops signing `<timestamp>.<body>` with HMAC-SHA256 of the secret as
// `v1=<hex>`, or verifyWebhook accepts a body, a secret or a timestamp that do not match, or a
// timestamp outside the tolerance, before or after now, or a request without its signature or its
// timestamp, or any request with an empty secret (a site that never set one), or refuses a webhook
// that is in order; or, given `isNew`, stops
// refusing an event it was given before, by the id of its signed body and never of the header.

const SECRET = 'whsec_test'
const BODY = '{"kind":"entry.published"}'
const AT = 1_760_000_000

/** HMAC-SHA256("whsec_test", "1760000000.{"kind":"entry.published"}"), worked out with openssl. */
const EXPECTED = 'v1=6e72d4ff1ad2c8840d8df404118422ed9178bf8dac32c33477b59728f94b55b7'

function headers(signature: string, timestamp = AT): Headers {
  return new Headers({ 'hollware-signature': signature, 'hollware-timestamp': String(timestamp) })
}

describe('webhook signatures', () => {
  it('sign the timestamp and the body with the secret', async () => {
    expect(await signWebhook(SECRET, AT, BODY)).toBe(EXPECTED)
  })

  it('verify a webhook that is in order', async () => {
    expect(
      await verifyWebhook({ secret: SECRET, body: BODY, headers: headers(EXPECTED), now: AT }),
    ).toBe(true)
  })

  it.each([
    ['another body', { body: `${BODY} ` }],
    ['another secret', { secret: 'whsec_other' }],
    ['a timestamp six minutes old', { now: AT + 360 }],
    ['a timestamp six minutes ahead', { now: AT - 360 }],
    ['no signature', { headers: new Headers({ 'hollware-timestamp': String(AT) }) }],
    ['no timestamp', { headers: new Headers({ 'hollware-signature': EXPECTED }) }],
  ])('refuse %s', async (_name, change) => {
    expect(
      await verifyWebhook({
        secret: SECRET,
        body: BODY,
        headers: headers(EXPECTED),
        now: AT,
        ...change,
      }),
    ).toBe(false)
  })

  it('refuse every webhook when the secret is empty, instead of failing on the empty key', async () => {
    // A receiver whose secret was never set: WebCrypto takes no empty HMAC key, and throws.
    expect(
      await verifyWebhook({ secret: '', body: BODY, headers: headers(EXPECTED), now: AT }),
    ).toBe(false)
  })

  it('refuse a signature for another timestamp', async () => {
    expect(
      await verifyWebhook({
        secret: SECRET,
        body: BODY,
        headers: headers(EXPECTED, AT + 1),
        now: AT,
      }),
    ).toBe(false)
  })
})

describe('webhook replays', () => {
  const body = '{"id":"evt_1","kind":"entry.published"}'
  /** A receiver's record of the events it has had, as a Set. */
  function receiver() {
    const seen = new Set<string>()
    const isNew = (id: string) => {
      if (seen.has(id)) return false
      seen.add(id)
      return true
    }
    return { seen, isNew }
  }

  it('take an event once, and refuse it sent again within the tolerance', async () => {
    const { seen, isNew } = receiver()
    const signed = new Headers({
      'hollware-signature': await signWebhook(SECRET, AT, body),
      'hollware-timestamp': String(AT),
      'hollware-event-id': 'evt_1',
    })
    const check = { secret: SECRET, body, headers: signed, now: AT + 60, isNew }

    expect([await verifyWebhook(check), await verifyWebhook(check)]).toEqual([true, false])
    expect([...seen]).toEqual(['evt_1'])
  })

  it('read the id from the signed body, so another id in the header changes nothing', async () => {
    const { isNew } = receiver()
    const signature = await signWebhook(SECRET, AT, body)
    const sent = (eventId: string) =>
      verifyWebhook({
        secret: SECRET,
        body,
        headers: new Headers({
          'hollware-signature': signature,
          'hollware-timestamp': String(AT),
          'hollware-event-id': eventId,
        }),
        now: AT,
        isNew,
      })

    expect([await sent('evt_1'), await sent('evt_forged')]).toEqual([true, false])
  })

  it('refuse a body with no id when the receiver keeps them, and never ask about a bad signature', async () => {
    const { seen, isNew } = receiver()

    expect(
      await verifyWebhook({
        secret: SECRET,
        body: BODY,
        headers: headers(EXPECTED),
        now: AT,
        isNew,
      }),
    ).toBe(false)
    expect(
      await verifyWebhook({
        secret: 'whsec_other',
        body,
        headers: headers(EXPECTED),
        now: AT,
        isNew,
      }),
    ).toBe(false)
    expect([...seen]).toEqual([])
  })
})
