import { cloudflare } from '@cloudflare/vite-plugin'
import { defineConfig } from 'vite-plus'

// Builds the second topology (src/roles.ts): `vp build --config vite.roles.config.ts`.
export default defineConfig({
  plugins: [cloudflare({ configPath: './wrangler.roles.jsonc' })],
})
