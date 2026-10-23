import { connect } from '../db/d1.ts'
import { membershipsOf } from '../identity/store.ts'
import type { AuditLine, AuditLog, AuditSite } from './log.ts'

export async function writeForPerson(
  db: D1Database,
  log: AuditLog,
  siteOf: (key: string) => Promise<AuditSite | undefined>,
  userId: string,
  line: AuditLine,
): Promise<void> {
  for (const membership of await membershipsOf(connect(db), userId)) {
    const site = await siteOf(membership.site)
    if (site !== undefined) await log.write(site, line)
  }
}
