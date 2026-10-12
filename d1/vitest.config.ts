import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vite-plus'
import { unstable_readConfig as readWranglerConfig } from 'wrangler'

// The test database gets the migrations that wrangler.jsonc points at, so the tests cannot
// drift from what `wrangler d1 migrations apply` would run.
const wranglerConfig = readWranglerConfig({ config: `${import.meta.dirname}/wrangler.jsonc` })
const migrationsDir: unknown = wranglerConfig.d1_databases.find(
  (database: { binding: string }) => database.binding === 'DB',
)?.migrations_dir
if (typeof migrationsDir !== 'string') {
  throw new Error('wrangler.jsonc must declare the D1 binding DB with a migrations_dir')
}

const readMigrations = (dir: string) =>
  readD1Migrations({ projectPath: import.meta.dirname, migrationsDir: dir })

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        // Read here in Node, applied inside workerd by the setup file.
        bindings: {
          TEST_MIGRATIONS: await readMigrations(migrationsDir),
          // Verbatim drizzle-kit output for two schema changes made after the triggers migration.
          // Only the s4d-*-migration tests apply them, each in its own database.
          ADDITIVE_MIGRATIONS: await readMigrations('test/fixtures/evolution/additive'),
          RECREATE_MIGRATIONS: await readMigrations('test/fixtures/evolution/recreate'),
        },
      },
    })),
  ],
  test: {
    name: 'spike-d1:workerd',
    include: ['**/*.workerd.test.ts'],
    setupFiles: ['test/workerd/apply-migrations.ts'],
    // The default, kept explicit: @cloudflare/vitest-plugin cannot read Vitest 5's module cache from
    // workerd ("no such file or directory, readAll .vitest-cache/..."), cloudflare/workers-sdk#15618.
    fsModuleCache: false,
  },
})
