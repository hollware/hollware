import { defineConfig } from 'vite-plus'

export default defineConfig({
  test: {
    name: 'web',
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
