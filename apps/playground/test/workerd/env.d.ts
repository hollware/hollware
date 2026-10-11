import type { D1Migration } from 'cloudflare:test'

declare global {
  namespace Cloudflare {
    interface Env {
      /** Added by vitest.config.ts: the migrations of the DB binding, applied by the setup file. */
      TEST_MIGRATIONS: D1Migration[]
    }
  }
}
