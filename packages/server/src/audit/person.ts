import { connect } from '../db/d1.ts'
import { membershipsOf } from '../identity/store.ts'
import type { AuditLine, AuditLog, AuditSite } from './log.ts'

/**
 * A line about a person's own sign-in, in each site they are a member of (ADR-037): a person is of
 * the deployment, and each owner sees what touched the people of their site.
 */
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
