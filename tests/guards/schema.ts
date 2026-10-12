import type { Violation } from './types.ts'

/**
 * Guard `schema`: the D1 schema of `packages/server/src/db/schema.ts` keeps its shape.
 *
 * - Every table has an `id` primary key and `created_at`/`updated_at`, both not null.
 * - Every table belongs to a site: `site_id` not null, a foreign key to `sites(id)`, and a unique
 *   key on `(id, site_id)`, so that other tables can point at it together with its site.
 * - A foreign key to another site's table is composite and carries `site_id` onto `site_id`, so
 *   a row can only point at rows of its own site. A foreign key to a table without sites
 *   (`users`, `sites`) is a plain one.
 *
 * The tables that are exempt arrive as arguments, from `tests/guards/exceptions.ts`; an
 * exemption that names no table, or a table that no longer needs it, is reported.
 */

export interface SchemaColumn {
  name: string
  notNull: boolean
  primary: boolean
}

export interface SchemaForeignKey {
  columns: readonly string[]
  table: string
  foreignColumns: readonly string[]
}

export interface SchemaTable {
  name: string
  columns: readonly SchemaColumn[]
  /** Every unique constraint and unique index, as the names of its columns. */
  uniques: readonly (readonly string[])[]
  foreignKeys: readonly SchemaForeignKey[]
}

export interface SchemaInput {
  tables: readonly SchemaTable[]
  /** Tables without `site_id`. */
  withoutSite: readonly string[]
  /** Tables without `id`, `created_at` and `updated_at`. */
  withoutSharedColumns: readonly string[]
}

const FILE = 'packages/server/src/db/schema.ts'

function sameColumns(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((column, index) => column === b[index])
}

export function checkSchema(input: SchemaInput): Violation[] {
  const violations: Violation[] = []
  const report = (rule: string, message: string): void => {
    violations.push({ rule: `schema/${rule}`, file: FILE, message })
  }
  const names = new Set(input.tables.map((table) => table.name))
  for (const [list, exempt] of [
    ['withoutSite', input.withoutSite],
    ['withoutSharedColumns', input.withoutSharedColumns],
  ] as const) {
    for (const name of exempt) {
      if (!names.has(name)) {
        report('stale-exception', `the exception ${list} names "${name}", which is not a table`)
      }
    }
  }
  const siteScoped = new Set(
    input.tables.map((table) => table.name).filter((name) => !input.withoutSite.includes(name)),
  )

  for (const table of input.tables) {
    const column = (name: string) => table.columns.find((candidate) => candidate.name === name)

    if (!input.withoutSharedColumns.includes(table.name)) {
      if (column('id')?.primary !== true) {
        report('id', `${table.name} has no "id" primary key: use id(prefix) from columns.ts`)
      }
      for (const name of ['created_at', 'updated_at']) {
        if (column(name)?.notNull !== true) {
          report(
            'timestamps',
            `${table.name} has no not-null "${name}": use timestamps() from columns.ts`,
          )
        }
      }
    }

    if (input.withoutSite.includes(table.name)) {
      if (column('site_id') !== undefined) {
        report(
          'stale-exception',
          `${table.name} has "site_id" but is listed in TABLES_WITHOUT_SITE: remove it from the list`,
        )
      }
    } else {
      if (column('site_id')?.notNull !== true) {
        report('site', `${table.name} has no not-null "site_id": every table belongs to a site`)
      }
      const toSites = table.foreignKeys.some(
        (fk) =>
          fk.table === 'sites' &&
          sameColumns(fk.columns, ['site_id']) &&
          sameColumns(fk.foreignColumns, ['id']),
      )
      if (!toSites) {
        report('site', `${table.name} has no foreign key from "site_id" to sites(id)`)
      }
      if (!table.uniques.some((unique) => sameColumns(unique, ['id', 'site_id']))) {
        report(
          'site',
          `${table.name} has no unique key on (id, site_id), which the composite foreign keys of other tables point at`,
        )
      }
    }

    for (const fk of table.foreignKeys) {
      if (!siteScoped.has(fk.table) || !siteScoped.has(table.name)) continue
      const at = fk.columns.indexOf('site_id')
      if (at === -1 || fk.foreignColumns[at] !== 'site_id') {
        report(
          'composite-key',
          `${table.name} (${fk.columns.join(', ')}) → ${fk.table} (${fk.foreignColumns.join(', ')}) must carry site_id onto site_id, so a row can only point at rows of its own site`,
        )
      }
    }
  }
  return violations
}
