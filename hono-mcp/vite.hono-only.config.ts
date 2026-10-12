import { cloudflare } from '@cloudflare/vite-plugin'
import { defineConfig } from 'vite-plus'

// The Hono-only Worker (wrangler.hono-only.jsonc, main = src/hono-only.ts): the S1 size baseline.
export default defineConfig({
  plugins: [cloudflare({ configPath: './wrangler.hono-only.jsonc' })],
  build: { outDir: 'dist-hono-only' },
})
