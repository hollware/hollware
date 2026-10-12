import { cloudflare } from '@cloudflare/vite-plugin'
import { defineConfig } from 'vite-plus'

// The fallback Worker (wrangler.precomputed.jsonc, main = src/index-precomputed.ts).
export default defineConfig({
  plugins: [cloudflare({ configPath: './wrangler.precomputed.jsonc' })],
  build: { outDir: 'dist-precomputed' },
})
