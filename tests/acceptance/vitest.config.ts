import { defineConfig } from 'vite-plus'

export default defineConfig({
  test: {
    name: 'acceptance',
    include: ['tests/acceptance/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['apps/playground/test/harness/build-workers.global-setup.ts'],
    hookTimeout: 180_000,
    testTimeout: 60_000,
  },
})
