import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vite-plus'

// The provider of the main Worker, run without global_fetch_strictly_public.
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.noflag.jsonc' } })],
  test: {
    name: 'spike-oauth:noflag',
    include: ['**/*.noflag.workerd.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    fsModuleCache: false,
  },
})
