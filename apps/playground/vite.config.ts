import { cloudflare } from '@cloudflare/vite-plugin'
import { defineConfig } from 'vite-plus'

export default defineConfig({
  plugins: [cloudflare()],
  build: {
    // The size budget (budgets.json, scripts/check-budgets.ts) is measured on this build, and a
    // Hollware project deploys it minified.
    minify: true,
  },
})
