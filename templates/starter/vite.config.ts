import { cloudflare } from '@cloudflare/vite-plugin'
import { adminAssets } from '@hollware/admin'
import { defineConfig } from 'vite-plus'

/** Where `vp dev` serves Hollware: the URL of HOLLWARE_PUBLIC_URL before the first deploy. */
const LOCAL_URL = 'http://localhost:5199'
/**
 * HOLLWARE_SECRET of this machine's Hollware, which seals the secrets of webhooks and signs preview
 * links: a fixed value, for development only (a deployed Worker gets its own from
 * `hollware deploy`). A .dev.vars with HOLLWARE_SECRET takes its place.
 */
const LOCAL_SECRET = 'hollware-local-development-only-not-a-secret'

export default defineConfig(({ command }) => ({
  plugins: [
    cloudflare({
      // `hollware deploy` writes the public URL into wrangler.jsonc, and the Worker answers only
      // the Host of HOLLWARE_PUBLIC_URL: in development it is this machine's, whatever is deployed.
      config:
        command === 'serve'
          ? (config) => ({
              vars: {
                HOLLWARE_SECRET: LOCAL_SECRET,
                ...config.vars,
                HOLLWARE_PUBLIC_URL: LOCAL_URL,
              },
            })
          : undefined,
    }),
  ],
  // The admin's built files: served at /admin/ in development, and copied into the build, where
  // the Worker's static assets hold them.
  publicDir: adminAssets(),
  // Hollware's own port, not Vite's default 5173, which the frontend next to it usually takes.
  // It must stay the port of HOLLWARE_PUBLIC_URL in wrangler.jsonc: with strictPort, a port in
  // use fails instead of moving to one the Host check would refuse.
  server: { port: 5199, strictPort: true },
  build: {
    // What you deploy is what the size budget of Hollware measures: minified.
    minify: true,
  },
  // `vp check` formats and lints the project as Hollware writes it. wrangler writes
  // worker-configuration.d.ts, so neither touches it.
  fmt: {
    semi: false,
    singleQuote: true,
    ignorePatterns: ['dist/**', '.wrangler/**', 'worker-configuration.d.ts'],
  },
  lint: {
    ignorePatterns: ['dist/**', '.wrangler/**', 'worker-configuration.d.ts'],
  },
}))
