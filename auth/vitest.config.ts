import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vite-plus'

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
  test: {
    name: 'spike-auth:workerd',
    include: ['**/*.workerd.test.ts'],
    // The default, kept explicit: @cloudflare/vitest-plugin cannot read Vitest 5's module cache from
    // workerd ("no such file or directory, readAll .vitest-cache/..."), cloudflare/workers-sdk#15618.
    fsModuleCache: false,
  },
})
