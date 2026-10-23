import { newId, type IdPrefix } from '@hollware/core'
import { text } from 'drizzle-orm/sqlite-core'

export function nowIso(): string {
  return new Date().toISOString()
}

export function id(prefix: IdPrefix) {
  return text('id')
    .primaryKey()
    .$defaultFn(() => newId(prefix))
}

export function siteId() {
  return text('site_id').notNull()
}

export function timestamps() {
  return {
    createdAt: text('created_at').notNull().$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().$defaultFn(nowIso).$onUpdateFn(nowIso),
  }
}
