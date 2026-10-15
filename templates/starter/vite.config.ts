import { cloudflare } from '@cloudflare/vite-plugin'
import { adminAssets } from '@hollware/admin'
import { defineConfig } from 'vite-plus'

export default defineConfig({
  plugins: [cloudflare()],
  // The admin's built files: served at /admin/ in development, and copied into the build, where
  // the Worker's static assets hold them.
  publicDir: adminAssets(),
  // Hollware's own port, not Vite's default 5173, which the frontend next to it usually takes.
  // It must stay the port of HOLLWARE_PUBLIC_URL in wrangler.jsonc: with strictPort, a port in
  // use fails instead of moving to one the Host check would refuse.
  server: { port: 5199, strictPort: true },
  build: {
    // What you deploy is what the size budget of Hollware measures: minified.
    minify: true,
  },
})
