import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vite-plus'

// The second topology: OAuthAuthorizationServer + one OAuthResourceServer per resource.
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.roles.jsonc' } })],
  test: {
    name: 'spike-oauth:roles',
    include: ['**/*.roles.workerd.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    fsModuleCache: false,
  },
})
