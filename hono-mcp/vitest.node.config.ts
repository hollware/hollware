import { defineConfig } from 'vite-plus'

export default defineConfig({
  test: {
    name: 'spike-hono-mcp:node',
    include: ['test/node/**/*.node.test.ts'],
    environment: 'node',
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
})
