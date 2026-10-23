import { describe, expect, it } from 'vite-plus/test'
import { checkLegacyRole } from '../guards/legacy-role.ts'
import { describeViolations } from '../guards/types.ts'
import { file } from '../support/fixtures.ts'
import { readRepoFiles } from '../support/repo.ts'

const isPackageSource = (path: string) => /^packages\/[^/]+\/src\/.+\.ts$/.test(path)

describe('legacy role', () => {
  it('no package source reads users.role', () => {
    const sources = readRepoFiles(isPackageSource)
    expect(sources.length).toBeGreaterThan(40)
    expect(describeViolations(checkLegacyRole({ sources }))).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    const check = (text: string) =>
      checkLegacyRole({ sources: [file('packages/x/src/a.ts', text)] })

    it('accepts a read of members, and the insert of a user', () => {
      expect(check('db.select({ role: members.role }).from(members)')).toEqual([])
      expect(check("INSERT INTO users (id, name, role) VALUES ('u', NULL, 'owner')")).toEqual([])
      expect(check(' * Nothing reads `users.role` since v0.3.\n// users.role is legacy')).toEqual(
        [],
      )
    })

    it('reports a read of users.role, in drizzle or in SQL', () => {
      expect(check('db.select({ role: users.role })').map((v) => v.rule)).toEqual([
        'legacy-role/read',
      ])
      expect(check("SELECT id FROM users WHERE role = 'owner'").map((v) => v.message)).toEqual([
        'line 1 reads users.role: read the role of a person in a site from members',
      ])
      expect(check('JOIN users AS u ON u.id = t.user_id SELECT u.role')).toHaveLength(1)
    })
  })
})
