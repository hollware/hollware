import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vite-plus'

// wrangler.jsonc opts out of Node.js compatibility, but this pool keeps it on for its own runner
// (test/workerd/pool-compat.workerd.test.ts pins that), so these tests cannot prove "works without
// Node". The run that does is test/node/built-worker.test.ts, in a real workerd.
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
  test: {
    name: 'spike-comark:workerd',
    include: ['test/workerd/**/*.workerd.test.ts'],
    // The default, kept explicit: @cloudflare/vitest-plugin cannot read Vitest 5's module cache from
    // workerd, cloudflare/workers-sdk#15618.
    fsModuleCache: false,
  },
})
