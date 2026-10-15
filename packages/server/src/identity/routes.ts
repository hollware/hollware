import { HollwareError } from '@hollware/core'
import type { Context, Hono } from 'hono'
import { connect } from '../db/d1.ts'
import type { GatewayEnv } from '../http/types.ts'
import type { Clock } from '../ports.ts'
import type { Ceremony } from './ceremonies.ts'
import { pageHeaders, setupPage, signInPage } from './pages.ts'

/**
 * The ceremonies, with SimpleWebAuthn and its parsers, in a chunk of their own: only these four
 * routes use them, and a Worker that serves MCP never pays for them at startup (`budgets.json`).
 */
const ceremonies = () => import('./ceremonies.ts')

/** The cookie of a signed-in person: only `/authorize` reads it (ADR-026). */
export const SESSION_COOKIE = 'hollware_session'

function sessionCookie(secret: string): string {
  return `${SESSION_COOKIE}=${secret}; HttpOnly; Secure; SameSite=Lax; Path=/authorize; Max-Age=43200`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The setup and sign-in pages, and the four steps of the passkey ceremonies. */
export function installIdentity(
  app: Hono<GatewayEnv>,
  options: { readonly site: string; readonly clock: Clock },
): void {
  const ceremony = (c: Context<GatewayEnv>): Ceremony => ({
    db: connect(c.env.DB),
    site: options.site,
    publicUrl: c.env.HOLLWARE_PUBLIC_URL,
    now: options.clock.now(),
  })
  const body = async (c: Context<GatewayEnv>): Promise<Record<string, unknown>> => {
    const value: unknown = await c.req.json().catch(() => null)
    if (!isRecord(value)) {
      throw new HollwareError(
        'invalid_input',
        'The body is not a JSON object.',
        'Send a JSON object.',
      )
    }
    return value
  }
  const text = (value: unknown) => (typeof value === 'string' ? value : '')
  const handle =
    (step: (c: Context<GatewayEnv>) => Promise<Response>) => async (c: Context<GatewayEnv>) => {
      try {
        return await step(c)
      } catch (error) {
        if (!(error instanceof HollwareError)) throw error
        return c.json({ code: error.code, message: error.message, fix: error.fix }, 400)
      }
    }

  const html = (render: (nonce: string) => string) => () => {
    const nonce = crypto.randomUUID().replace(/-/g, '')
    return new Response(render(nonce), { headers: pageHeaders(nonce) })
  }
  app.get('/setup', html(setupPage))
  app.get('/signin', html(signInPage))

  app.post(
    '/auth/register/options',
    handle(async (c) =>
      c.json(
        await (
          await ceremonies()
        ).registrationOptions(ceremony(c), text((await body(c))['invitation'])),
      ),
    ),
  )
  app.post(
    '/auth/register/verify',
    handle(async (c) => {
      const input = await body(c)
      const response = input['response']
      if (!isRecord(response)) {
        throw new HollwareError(
          'invalid_input',
          'The body has no passkey.',
          'Send the credential as JSON.',
        )
      }
      const answer = await (
        await ceremonies()
      ).verifyRegistration(ceremony(c), {
        challengeId: text(input['challengeId']),
        // SimpleWebAuthn checks every field of the credential it reads.
        response: JSON.parse(JSON.stringify(response)),
        name: text(input['name']),
        label: text(input['label']),
      })
      return c.json({ ok: true }, 200, { 'set-cookie': sessionCookie(answer.session) })
    }),
  )
  app.post(
    '/auth/signin/options',
    handle(async (c) => c.json(await (await ceremonies()).authenticationOptions(ceremony(c)))),
  )
  app.post(
    '/auth/signin/verify',
    handle(async (c) => {
      const input = await body(c)
      const response = input['response']
      if (!isRecord(response)) {
        throw new HollwareError(
          'invalid_input',
          'The body has no passkey.',
          'Send the credential as JSON.',
        )
      }
      const answer = await (
        await ceremonies()
      ).verifyAuthentication(ceremony(c), {
        challengeId: text(input['challengeId']),
        response: JSON.parse(JSON.stringify(response)),
      })
      return c.json({ ok: true }, 200, { 'set-cookie': sessionCookie(answer.session) })
    }),
  )
}
