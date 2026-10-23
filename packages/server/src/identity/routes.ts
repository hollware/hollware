import { HollwareError } from '@hollware/core'
import type { Context, Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { connect } from '../db/d1.ts'
import type { GatewayEnv } from '../http/types.ts'
import type { Clock } from '../ports.ts'
import type { Ceremony } from './ceremonies.ts'
import { pageHeaders, setupPage, signInPage } from './pages.ts'
import { endSession } from './store.ts'
import {
  personActor,
  type AuditActor,
  type AuditLine,
  type AuditLog,
  type AuditSite,
} from '../audit/log.ts'
import { writeForPerson } from '../audit/person.ts'

const ceremonies = () => import('./ceremonies.ts')

export const SESSION_COOKIE = 'hollware_session'

export const SIGN_OUT_PATH = '/authorize/signout'

function sessionCookie(secret: string): string {
  return `${SESSION_COOKIE}=${secret}; HttpOnly; Secure; SameSite=Lax; Path=/authorize; Max-Age=43200`
}

const ENDED_COOKIE = `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/authorize; Max-Age=0`

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export interface IdentityOptions {
  readonly clock: Clock
  readonly site: (c: Context<GatewayEnv>, key: string) => Promise<AuditSite | undefined>
  readonly audit: (c: Context<GatewayEnv>, actor: AuditActor) => AuditLog
}

export function installIdentity(app: Hono<GatewayEnv>, options: IdentityOptions): void {
  const audited = (c: Context<GatewayEnv>, userId: string, line: AuditLine) =>
    writeForPerson(
      c.env.DB,
      options.audit(c, personActor(userId)),
      (key) => options.site(c, key),
      userId,
      line,
    )

  const ceremony = (c: Context<GatewayEnv>): Ceremony => ({
    db: connect(c.env.DB),
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
        response: JSON.parse(JSON.stringify(response)),
        name: text(input['name']),
        label: text(input['label']),
      })
      await audited(c, answer.userId, {
        action: 'invitation.accept',
        outcome: 'ok',
        target: { type: 'user', id: answer.userId },
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
      await audited(c, answer.userId, {
        action: 'session.sign_in',
        outcome: 'ok',
        target: { type: 'user', id: answer.userId },
      })
      return c.json({ ok: true }, 200, { 'set-cookie': sessionCookie(answer.session) })
    }),
  )

  app.post(SIGN_OUT_PATH, async (c) => {
    const secret = getCookie(c, SESSION_COOKIE)
    const userId = secret === undefined ? null : await endSession(connect(c.env.DB), secret)
    if (userId !== null) {
      await audited(c, userId, {
        action: 'session.sign_out',
        outcome: 'ok',
        target: { type: 'user', id: userId },
      })
    }
    return c.json({ ok: true }, 200, { 'set-cookie': ENDED_COOKIE, 'cache-control': 'no-store' })
  })
}
