import { cloudflare } from '@cloudflare/vite-plugin'
import { adminAssets } from '@hollware/admin'
import { defineConfig } from 'vite-plus'

export default defineConfig({
  plugins: [cloudflare()],
  publicDir: adminAssets(),
  server: { port: 5199, strictPort: true },
  build: {
    minify: true,
  },
})
