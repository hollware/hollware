import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vite-plus'

export default defineConfig({
  plugins: [cloudflareTest({ miniflare: { compatibilityDate: '2026-10-06' } })],
  test: {
    name: 'core:workerd',
    include: ['tests/**/*.test.ts'],
    fsModuleCache: false,
  },
})
