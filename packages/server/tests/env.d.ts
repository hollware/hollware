import type { D1Migration } from 'cloudflare:test'

declare global {
  namespace Cloudflare {
    interface Env {
      /** Added by vitest.workerd.config.ts: the migrations of the package, applied by the setup file. */
      TEST_MIGRATIONS: D1Migration[]
    }
  }
}
