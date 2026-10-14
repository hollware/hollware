import { describe, expect, it } from 'vite-plus/test'

import { signWebhook, verifyWebhook } from '../src/webhooks.ts'

// Fails when: src/webhooks.ts stops signing `<timestamp>.<body>` with HMAC-SHA256 of the secret as
// `v1=<hex>`, or verifyWebhook accepts a body, a secret or a timestamp that do not match, or a
// timestamp outside the tolerance, or refuses a webhook that is in order.

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
