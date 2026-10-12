import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vite-plus'

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      // Requests made through exports.default.fetch carry no Host header, so the DNS rebinding
      // guard of /mcp (ALLOWED_HOSTS) is off here; the guard has its own test that sets Host.
      miniflare: { bindings: { ALLOWED_HOSTS: '' } },
    }),
  ],
  test: {
    name: 'spike-hono-mcp:workerd',
    include: ['test/workerd/**/*.workerd.test.ts'],
    // The default, kept explicit: @cloudflare/vitest-plugin cannot read Vitest 5's module cache from
    // workerd, cloudflare/workers-sdk#15618.
    fsModuleCache: false,
  },
})
