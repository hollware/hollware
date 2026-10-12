import { defineConfig } from 'vite-plus'

export default defineConfig({
  test: {
    name: 'spike-d1:node',
    include: ['test/node/**/*.test.ts'],
    environment: 'node',
    // Each test starts drizzle-kit, which bundles the schema before it reads anything.
    testTimeout: 60_000,
  },
})
