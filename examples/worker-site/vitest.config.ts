import { defineConfig } from 'vite-plus'

export default defineConfig({
  test: {
    name: 'worker-site',
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
})
