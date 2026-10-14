import { cloudflare } from '@cloudflare/vite-plugin'
import { defineConfig } from 'vite-plus'

export default defineConfig({
  plugins: [cloudflare()],
  // Hollware's own port, not Vite's default 5173, which the frontend next to it usually takes.
  // It must stay the port of HOLLWARE_PUBLIC_URL in wrangler.jsonc: with strictPort, a port in
  // use fails instead of moving to one the Host check would refuse.
  server: { port: 5199, strictPort: true },
  build: {
    // The size budget (budgets.json, scripts/check-budgets.ts) is measured on this build, and a
    // Hollware project deploys it minified.
    minify: true,
  },
})
