import { defineConfig } from 'vite-plus'

// The acceptance suites of the stages (`vp run test:acceptance`). They run against the production
// builds of the playground and the example site, which the global setup builds first, so they
// work on a clean checkout.
export default defineConfig({
  test: {
    name: 'acceptance',
    include: ['tests/acceptance/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['apps/playground/test/harness/build-workers.global-setup.ts'],
    // Building two Workers, starting workerd and seeding a database with the CLI happen in hooks.
    hookTimeout: 180_000,
    testTimeout: 60_000,
  },
})
