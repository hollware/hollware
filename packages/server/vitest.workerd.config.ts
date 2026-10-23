import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vite-plus'

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations({
            projectPath: import.meta.dirname,
            migrationsDir: 'migrations',
          }),
        },
      },
    })),
  ],
  test: {
    name: 'server:workerd',
    include: ['tests/**/*.workerd.test.ts'],
    setupFiles: ['tests/apply-migrations.ts'],
    fsModuleCache: false,
  },
})
