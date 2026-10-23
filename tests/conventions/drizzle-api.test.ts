import { describe, expect, it } from 'vite-plus/test'
import { checkDrizzleApi } from '../guards/drizzle-api.ts'
import { describeViolations } from '../guards/types.ts'
import { file } from '../support/fixtures.ts'
import { readRepoFiles } from '../support/repo.ts'

const isServerSource = (path: string) => /^packages\/server\/src\/.+\.ts$/.test(path)

describe('drizzle api', () => {
  it('packages/server/src uses neither db.query nor relations of drizzle', () => {
    const sources = readRepoFiles(isServerSource)
    expect(sources.length).toBeGreaterThan(40)
    expect(describeViolations(checkDrizzleApi(sources))).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    const check = (text: string) => checkDrizzleApi([file('packages/server/src/a.ts', text)])

    it('accepts the query builder, a query of Hono or Vectorize, and the words in a comment or a string', () => {
      expect(
        check(
          [
            "import { eq } from 'drizzle-orm'",
            'db.select().from(entries).where(eq(entries.id, id))',
            "c.req.query('site')",
            'semantic.index.query(vector)',
            '// db.query.entries.findMany()',
            "const text = 'relations(entries)'",
          ].join('\n'),
        ),
      ).toEqual([])
    })

    it('reports db.query, on the database or on what holds it', () => {
      expect(check('const a = 1\nawait db.query.entries.findMany()')).toEqual([
        {
          rule: 'drizzle-api/relational',
          file: 'packages/server/src/a.ts',
          message:
            'line 2 reads db.query, the relational API of drizzle: Hollware writes its queries with the query builder',
        },
      ])
      expect(check('await context.db.query.sites.findFirst()').map((v) => v.rule)).toEqual([
        'drizzle-api/relational',
      ])
    })

    it('reports relations imported from drizzle-orm', () => {
      expect(check("import { eq, relations } from 'drizzle-orm'")).toEqual([
        {
          rule: 'drizzle-api/relational',
          file: 'packages/server/src/a.ts',
          message:
            'line 1 imports relations from drizzle-orm: Hollware writes its queries with the query builder',
        },
      ])
      expect(
        check("import { relations as r } from 'drizzle-orm/relations'").map((v) => v.message),
      ).toEqual([
        'line 1 imports relations from drizzle-orm/relations: Hollware writes its queries with the query builder',
      ])
    })
  })
})
