import type { Role } from '../auth/roles.ts'

export type PeopleChange = 'changed' | 'unchanged' | 'not_member' | 'last_owner'

const OTHER_OWNERS =
  "(SELECT count(*) FROM members WHERE site_id = ?1 AND role = 'owner' AND user_id <> ?2) > 0"

async function roleOf(db: D1Database, site: string, userId: string): Promise<string | null> {
  return db
    .prepare('SELECT role FROM members WHERE site_id = ?1 AND user_id = ?2')
    .bind(site, userId)
    .first<string>('role')
}

export async function setRole(
  db: D1Database,
  input: {
    readonly site: string
    readonly userId: string
    readonly role: Role
    readonly now: string
  },
): Promise<PeopleChange> {
  const current = await roleOf(db, input.site, input.userId)
  if (current === null) return 'not_member'
  if (current === input.role) return 'unchanged'
  const result = await db
    .prepare(
      `UPDATE members SET role = ?3, updated_at = ?4 WHERE site_id = ?1 AND user_id = ?2
       AND (role <> 'owner' OR ?3 = 'owner' OR ${OTHER_OWNERS})`,
    )
    .bind(input.site, input.userId, input.role, input.now)
    .run()
  return result.meta.changes === 1 ? 'changed' : 'last_owner'
}

export async function removeMember(
  db: D1Database,
  input: { readonly site: string; readonly userId: string },
): Promise<PeopleChange> {
  if ((await roleOf(db, input.site, input.userId)) === null) return 'not_member'
  const result = await db
    .prepare(
      `DELETE FROM members WHERE site_id = ?1 AND user_id = ?2 AND (role <> 'owner' OR ${OTHER_OWNERS})`,
    )
    .bind(input.site, input.userId)
    .run()
  return result.meta.changes === 1 ? 'changed' : 'last_owner'
}
