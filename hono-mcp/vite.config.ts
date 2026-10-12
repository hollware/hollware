import { cloudflare } from '@cloudflare/vite-plugin'
import { defineConfig } from 'vite-plus'

// The Hono + MCP Worker (wrangler.jsonc, main = src/index.ts).
export default defineConfig({
  plugins: [cloudflare()],
})
