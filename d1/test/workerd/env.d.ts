import type { D1Migration } from 'cloudflare:test'

declare global {
  namespace Cloudflare {
    interface Env {
      /** Added by vitest.config.ts: the migrations of the DB binding, applied by the setup file. */
      TEST_MIGRATIONS: D1Migration[]
      /** The drizzle-kit migration for a nullable derived column on `revisions`. */
      ADDITIVE_MIGRATIONS: D1Migration[]
      /** The drizzle-kit migration that rebuilds `revisions` (CREATE __new_revisions, DROP, RENAME). */
      RECREATE_MIGRATIONS: D1Migration[]
    }
  }
}
