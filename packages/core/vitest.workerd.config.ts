import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vite-plus'

// The tests of core once more, inside workerd, without a Worker of its own (ADR-018). The test
// runner keeps Node.js compatibility on whatever the flags say, so this run proves that core
// works in workerd; what keeps Node out of core is the type environment of src.
export default defineConfig({
  plugins: [cloudflareTest({ miniflare: { compatibilityDate: '2026-10-06' } })],
  test: {
    name: 'core:workerd',
    include: ['tests/**/*.test.ts'],
    // The default, kept explicit: @cloudflare/vitest-plugin cannot read Vitest 5's module cache from
    // workerd ("no such file or directory, readAll .vitest-cache/..."), cloudflare/workers-sdk#15618.
    fsModuleCache: false,
  },
})
