import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider'

// `wrangler types` declares the bindings twice, on the global `Env` and on `Cloudflare.Env` (what
// `import { env } from 'cloudflare:workers'` returns). OAuthProvider injects OAUTH_PROVIDER into
// the env of the default handler and of the API handlers, so it is declared on both.
declare global {
  interface Env {
    OAUTH_PROVIDER: OAuthHelpers
  }
  namespace Cloudflare {
    interface Env {
      OAUTH_PROVIDER: OAuthHelpers
    }
  }
}
