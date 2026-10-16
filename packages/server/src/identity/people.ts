import type { Role } from '../auth/roles.ts'

/**
 * The members of a site, changed by its owners in the admin (0.8.0): another role, or out of the
 * site. A site always keeps one owner: the statement that would demote or remove its last one
 * changes nothing, in the same step that counts them, so two owners demoting each other at once
 * cannot both succeed. A member removed from a site loses at once every token and grant of it,
 * which find their role through `members` on each request.
 */

export type PeopleChange = 'changed' | 'unchanged' | 'not_member' | 'last_owner'

/** The owners of the site besides `userId`, counted in the statement that changes `userId`. */
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
