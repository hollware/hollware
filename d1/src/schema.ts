import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const entries = sqliteTable('entries', {
  id: text('id').primaryKey(),
  version: integer('version').notNull(),
  headRev: text('head_rev'),
})

export const revisions = sqliteTable('revisions', {
  id: text('id').primaryKey(),
  entryId: text('entry_id')
    .notNull()
    .references(() => entries.id),
  markdown: text('markdown').notNull(),
  createdAt: text('created_at').notNull(),
})
