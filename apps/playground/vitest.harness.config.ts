import { defineConfig } from 'vite-plus'

export default defineConfig({
  test: {
    name: 'playground:harness',
    include: ['test/harness/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['test/harness/build-workers.global-setup.ts'],
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
})
