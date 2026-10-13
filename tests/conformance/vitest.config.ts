import { defineConfig } from 'vite-plus'

export default defineConfig({
  test: {
    name: 'conformance',
    include: ['tests/conformance/**/*.test.ts'],
    exclude: ['tests/conformance/worker/**'],
    environment: 'node',
  },
})
