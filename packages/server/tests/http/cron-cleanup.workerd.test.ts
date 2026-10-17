import { describe, expect, it } from 'vitest'

import { boot } from './support.ts'

// Fails when: the cron trigger of Hollware (src/compose.ts, `dropExpired` of
// src/identity/store.ts) stops dropping the WebAuthn challenges that nobody took and the sessions
// that expired, which anyone could make grow by a row a request (T-11 of
// docs/security/threat-model.md), or drops a challenge or a session that is still good.

const PAST = '2000-01-01T00:00:00.000Z'
const FUTURE = '2099-01-01T00:00:00.000Z'

describe('the cron trigger and what of sign-in expired', () => {
  it('drops the challenges and sessions that expired, and keeps the others', async () => {
    const worker = boot()
    const db = worker.env.DB
    const user = `usr_${crypto.randomUUID().replaceAll('-', '').slice(0, 26).toUpperCase()}`
    await db
      .prepare(
        "INSERT INTO users (id, name, role, created_at, updated_at) VALUES (?1, 'Cron', 'editor', ?2, ?2)",
      )
      .bind(user, PAST)
      .run()
    const tag = crypto.randomUUID().slice(0, 8)
    const challenge = (id: string, expires: string) =>
      db
        .prepare(
          "INSERT INTO auth_challenges (id, challenge, purpose, expires_at, created_at, updated_at) VALUES (?1, 'c', 'authenticate', ?2, ?3, ?3)",
        )
        .bind(id, expires, PAST)
    const session = (id: string, expires: string) =>
      db
        .prepare(
          'INSERT INTO sessions (id, user_id, hash, expires_at, created_at, updated_at) VALUES (?1, ?2, ?1, ?3, ?4, ?4)',
        )
        .bind(id, user, expires, PAST)
    await db.batch([
      challenge(`chl_old_${tag}`, PAST),
      challenge(`chl_new_${tag}`, FUTURE),
      session(`ses_old_${tag}`, PAST),
      session(`ses_new_${tag}`, FUTURE),
    ])

    await worker.worker.scheduled(
      {
        scheduledTime: Date.parse('2026-10-16T12:01:00Z'),
        cron: '* * * * *',
        noRetry: () => undefined,
      },
      worker.env,
      worker.ctx,
    )
    await worker.settle()

    const left = async (table: string) =>
      (
        await db
          .prepare(`SELECT id FROM ${table} WHERE id LIKE ?1 ORDER BY id`)
          .bind(`%_${tag}`)
          .all<{ id: string }>()
      ).results.map((row) => row.id)
    expect(await left('auth_challenges')).toEqual([`chl_new_${tag}`])
    expect(await left('sessions')).toEqual([`ses_new_${tag}`])
  })
})
