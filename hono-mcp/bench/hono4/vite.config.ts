import { cloudflare } from '@cloudflare/vite-plugin'
import { resolve } from 'node:path'
import { defineConfig } from 'vite-plus'

const hono4 = resolve(
  import.meta.dirname,
  '../../../../node_modules/.pnpm/hono@4.13.13/node_modules/hono/dist',
)

// Measurement only: `hono` resolves to 4.13.13 from the pnpm store.
export default defineConfig({
  plugins: [cloudflare({ configPath: './bench/hono4/wrangler.jsonc' })],
  resolve: {
    alias: [
      { find: /^hono\/http-exception$/, replacement: `${hono4}/http-exception.js` },
      { find: /^hono$/, replacement: `${hono4}/index.js` },
    ],
  },
  build: { outDir: 'dist-hono4' },
})
