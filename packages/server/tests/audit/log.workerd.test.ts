import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import { createAuditLog, personActor, type AuditLogEntry } from '../../src/audit/log.ts'
import { countRows, siteKey } from '../db/support.ts'

const NOW = '2026-10-12T18:30:00.000Z'
const USER_ID = 'usr_01JAB3XQ8ZK4M6N2P5R7S9T0VW'

function auditFor(master: string | undefined, address: string | null) {
  const logged: AuditLogEntry[] = []
  const audit = createAuditLog({
    db: env.DB,
    actor: personActor(USER_ID),
    requestId: 'req-audit-1',
    address,
    master,
    now: () => new Date(NOW),
    log: (entry) => logged.push(entry),
  })
  return { audit, logged }
}

async function writeSiteRow(key: string): Promise<void> {
  await env.DB.prepare('INSERT INTO sites (id, created_at, updated_at) VALUES (?1, ?2, ?2)')
    .bind(key, NOW)
    .run()
}

describe('a line of the activity log written on its own', () => {
  it('never fails the request: a line D1 refuses is logged as audit_write_failed', async () => {
    const site = siteKey('audit-no-site-row')
    const { audit, logged } = auditFor(undefined, null)

    const written = audit.write(
      { key: site, audit: { ipAddresses: 'off', retentionDays: null } },
      { action: 'create_draft', outcome: 'ok' },
    )

    await expect(written).resolves.toBe(undefined)
    expect(logged).toEqual([
      {
        kind: 'audit_write_failed',
        site,
        action: 'create_draft',
        requestId: 'req-audit-1',
        message: expect.stringContaining('FOREIGN KEY constraint failed'),
      },
    ])
    expect(await countRows(env.DB, 'audit_log', site)).toBe(0)
  })

  it('keeps no address of a site that keeps them when the Worker has no HOLLWARE_SECRET, and logs it', async () => {
    const site = siteKey('audit-unkeyed')
    await writeSiteRow(site)
    const { audit, logged } = auditFor(undefined, '203.0.113.7')

    await audit.write(
      { key: site, audit: { ipAddresses: 'hashed', retentionDays: null } },
      { action: 'create_draft', outcome: 'ok' },
    )

    expect(logged).toEqual([{ kind: 'audit_address_unkeyed', site, requestId: 'req-audit-1' }])
    const row = await env.DB.prepare('SELECT ip_hash FROM audit_log WHERE site_id = ?1')
      .bind(site)
      .first<{ ip_hash: string | null }>()
    expect(row).toEqual({ ip_hash: null })
  })
})
