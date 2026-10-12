import { cloudflare } from '@cloudflare/vite-plugin'
import { defineConfig } from 'vite-plus'

// The S2c probe Worker (wrangler.probe.jsonc): what real workerd allows.
export default defineConfig({
  plugins: [cloudflare({ configPath: './wrangler.probe.jsonc' })],
  build: { outDir: 'dist-probe' },
})
