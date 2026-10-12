import { cloudflare } from '@cloudflare/vite-plugin'
import { defineConfig } from 'vite-plus'

export default defineConfig({
  root: import.meta.dirname,
  plugins: [cloudflare({ configPath: './wrangler.jsonc' })],
  build: { outDir: '../../dist/render-only', emptyOutDir: true },
})
