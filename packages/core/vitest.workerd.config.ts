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
    // Off: @cloudflare/vitest-plugin reads Vitest's module cache from workerd since 1.4.3
    // (cloudflare/workers-sdk#15618), but it saved no time here (server:workerd, 13 s either way).
    fsModuleCache: false,
  },
})
