import { generateAgentGrant, generatePersonalToken, hashPersonalToken, newId } from '@hollware/core'
import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import { seedToken } from '../auth/support.ts'
import { INPUTS } from '../mcp/support.ts'
import { boot, SITE_KEY } from '../http/support.ts'

const CREATED = '2026-10-13T11:00:00.000Z'
const EXPIRES = '2026-10-13T13:00:00.000Z'

async function seedGrant(scopes: readonly string[], kind = 'agent'): Promise<string> {
  const userId = newId('usr')
  const token = generateAgentGrant()
  await env.DB.batch([
    env.DB.prepare(
      'INSERT OR IGNORE INTO sites (id, created_at, updated_at) VALUES (?1, ?2, ?2)',
    ).bind(SITE_KEY, CREATED),
    env.DB.prepare(
      `INSERT INTO users (id, name, role, kind, created_at, updated_at)
        VALUES (?1, 'reviewer', 'reviewer', ?3, ?2, ?2)`,
    ).bind(userId, CREATED, kind),
    env.DB.prepare(
      `INSERT INTO members (id, site_id, user_id, role, created_at, updated_at)
        VALUES (?1, ?2, ?3, 'author', ?4, ?4)`,
    ).bind(newId('mbr'), SITE_KEY, userId, CREATED),
    env.DB.prepare(
      `INSERT INTO agent_grants (id, site_id, user_id, agent, review_id, hash, scopes, expires_at, created_at, updated_at)
        VALUES (?1, ?2, ?3, 'reviewer', NULL, ?4, ?5, ?6, ?7, ?7)`,
    ).bind(
      newId('agt'),
      SITE_KEY,
      userId,
      await hashPersonalToken(token),
      JSON.stringify(scopes),
      EXPIRES,
      CREATED,
    ),
  ])
  return token
}

async function seedAgentToken(scopes: readonly string[]): Promise<string> {
  const userId = newId('usr')
  const token = generatePersonalToken()
  await env.DB.batch([
    env.DB.prepare(
      'INSERT OR IGNORE INTO sites (id, created_at, updated_at) VALUES (?1, ?2, ?2)',
    ).bind(SITE_KEY, CREATED),
    env.DB.prepare(
      `INSERT INTO users (id, name, role, kind, created_at, updated_at)
        VALUES (?1, 'gateway', 'reviewer', 'agent', ?2, ?2)`,
    ).bind(userId, CREATED),
    env.DB.prepare(
      `INSERT INTO members (id, site_id, user_id, role, created_at, updated_at)
        VALUES (?1, ?2, ?3, 'author', ?4, ?4)`,
    ).bind(newId('mbr'), SITE_KEY, userId, CREATED),
    env.DB.prepare(
      `INSERT INTO tokens (id, site_id, user_id, label, hash, scopes, expires_at, created_at, updated_at)
        VALUES (?1, ?2, ?3, 'gateway', ?4, ?5, NULL, ?6, ?6)`,
    ).bind(
      newId('tok'),
      SITE_KEY,
      userId,
      await hashPersonalToken(token),
      JSON.stringify(scopes),
      CREATED,
    ),
  ])
  return token
}

async function statusesOf(token: string, names: readonly (keyof typeof INPUTS)[]) {
  const worker = boot()
  const statuses: Record<string, number> = {}
  for (const name of names) {
    const response = await worker.send(`/v1/ops/${name}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(INPUTS[name]),
      token,
    })
    statuses[name] = response.status
  }
  return statuses
}

const NAMES = [
  'list_reviews',
  'get_review',
  'comment_review',
  'create_draft',
  'publish',
  'approve_review',
] as const

describe('what a token may do with reviews', () => {
  it('lets an agent grant of the default scopes read and comment, and never write, publish or approve', async () => {
    const token = await seedGrant(['content:read', 'review:read', 'review:comment'])

    expect(await statusesOf(token, NAMES)).toEqual({
      list_reviews: 200,
      get_review: 200,
      comment_review: 200,
      create_draft: 403,
      publish: 403,
      approve_review: 403,
    })
  })

  it('keeps no more than an author has, whatever scopes a grant row holds', async () => {
    const token = await seedGrant(['content:read', 'content:publish', 'schema:admin'])

    expect(await statusesOf(token, ['list_reviews', 'publish', 'approve_review'])).toEqual({
      list_reviews: 200,
      publish: 403,
      approve_review: 403,
    })
  })

  it("never lets an agent's personal token approve, unpublish or change the site, whatever scopes its row holds", async () => {
    const token = await seedAgentToken([
      'content:read',
      'content:write',
      'content:publish',
      'schema:admin',
    ])

    expect(
      await statusesOf(token, ['create_draft', 'approve_review', 'unpublish', 'update_site']),
    ).toEqual({
      create_draft: 200,
      approve_review: 403,
      unpublish: 403,
      update_site: 403,
    })
  })

  it('refuses a grant whose member is a person, not an agent', async () => {
    const token = await seedGrant(['content:read', 'review:read'], 'person')

    expect(await statusesOf(token, ['list_reviews'])).toEqual({ list_reviews: 401 })
  })

  it('lets a personal token of 1.0, with content scopes only, still list and comment', async () => {
    const seeded = await seedToken(env.DB, SITE_KEY, {
      role: 'author',
      scopes: ['content:read', 'content:write'],
      expiresAt: EXPIRES,
    })

    expect(await statusesOf(seeded.token, ['list_reviews', 'comment_review'])).toEqual({
      list_reviews: 200,
      comment_review: 200,
    })
  })

  it('lets a token of the review scopes comment and read, but not write a draft', async () => {
    const seeded = await seedToken(env.DB, SITE_KEY, {
      role: 'author',
      scopes: ['content:read', 'review:read', 'review:comment'],
      expiresAt: EXPIRES,
    })

    expect(
      await statusesOf(seeded.token, ['list_reviews', 'comment_review', 'create_draft']),
    ).toEqual({ list_reviews: 200, comment_review: 200, create_draft: 403 })
  })

  it('refuses a token of content:read alone a comment', async () => {
    const seeded = await seedToken(env.DB, SITE_KEY, {
      role: 'author',
      scopes: ['content:read'],
      expiresAt: EXPIRES,
    })

    expect(await statusesOf(seeded.token, ['list_reviews', 'comment_review'])).toEqual({
      list_reviews: 200,
      comment_review: 403,
    })
  })
})
