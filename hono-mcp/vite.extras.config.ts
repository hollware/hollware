import { cloudflare } from '@cloudflare/vite-plugin'
import { defineConfig } from 'vite-plus'

// The extras Worker (wrangler.extras.jsonc, main = src/index-extras.ts): progress, MRTR and scopes.
export default defineConfig({
  plugins: [cloudflare({ configPath: './wrangler.extras.jsonc' })],
  build: { outDir: 'dist-extras' },
})
