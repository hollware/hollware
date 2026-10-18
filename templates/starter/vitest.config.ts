import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vite-plus'
import { unstable_readConfig as readWranglerConfig } from 'wrangler'

// The test database gets the migrations that wrangler.jsonc points at, so the tests cannot drift
// from what `wrangler d1 migrations apply` would run.
const wranglerConfig = readWranglerConfig({ config: `${import.meta.dirname}/wrangler.jsonc` })
const migrationsDir: unknown = wranglerConfig.d1_databases.find(
  (database: { binding: string }) => database.binding === 'DB',
)?.migrations_dir
if (typeof migrationsDir !== 'string') {
  throw new Error('wrangler.jsonc must declare the D1 binding DB with a migrations_dir')
}

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          // The tests reach the Worker at localhost, whatever public URL `hollware deploy` wrote
          // into wrangler.jsonc: it answers only the Host of HOLLWARE_PUBLIC_URL.
          HOLLWARE_PUBLIC_URL: 'http://localhost:5199',
          // Read here in Node and applied inside workerd by the setup file.
          TEST_MIGRATIONS: await readD1Migrations({
            projectPath: import.meta.dirname,
            migrationsDir,
          }),
        },
      },
    })),
  ],
  test: {
    name: 'starter:workerd',
    include: ['test/**/*.workerd.test.ts'],
    setupFiles: ['test/apply-migrations.ts'],
    // Off: @cloudflare/vitest-plugin reads Vitest's module cache from workerd since 1.4.3
    // (cloudflare/workers-sdk#15618), but it saved no time here (server:workerd, 13 s either way).
    fsModuleCache: false,
  },
})
