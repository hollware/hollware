import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vite-plus'

// The tests of the server that need workerd: D1, `cloudflare:*` modules, the Worker itself.
// The test database gets the package's own migrations, read here in Node and applied inside
// workerd by the setup file. The runner keeps Node.js compatibility on whatever wrangler.jsonc
// says, so these tests never prove that the code runs without Node.js.
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
    // Off: @cloudflare/vitest-plugin reads Vitest's module cache from workerd since 1.4.3
    // (cloudflare/workers-sdk#15618), but it saved no time here (server:workerd, 13 s either way).
    fsModuleCache: false,
  },
})
