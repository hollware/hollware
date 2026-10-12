import { defineConfig } from 'vite-plus'

export default defineConfig({
  test: {
    name: 'spike-comark:node',
    include: ['test/node/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
  },
})
