import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vite-plus'

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
  test: {
    name: 'spike-oauth:workerd',
    include: ['**/*.workerd.test.ts'],
    // The other Workers of the spike have their own project: vitest.roles.config.ts (the second
    // topology) and vitest.noflag.config.ts (the same Worker without global_fetch_strictly_public).
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/*.roles.workerd.test.ts',
      '**/*.noflag.workerd.test.ts',
    ],
    // The default, kept explicit: @cloudflare/vitest-plugin cannot read Vitest 5's module cache from
    // workerd ("no such file or directory, readAll .vitest-cache/..."), cloudflare/workers-sdk#15618.
    fsModuleCache: false,
  },
})
