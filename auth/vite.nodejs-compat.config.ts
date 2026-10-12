import { cloudflare } from '@cloudflare/vite-plugin'
import { defineConfig } from 'vite-plus'

// The same Worker built with wrangler.nodejs-compat.jsonc (Node.js compatibility on): only for the
// comparison of size and startup. `vp build -c vite.nodejs-compat.config.ts --outDir dist-compat`.
export default defineConfig({
  plugins: [cloudflare({ configPath: './wrangler.nodejs-compat.jsonc' })],
})
