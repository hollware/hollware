import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vite-plus'
import { unstable_readConfig as readWranglerConfig } from 'wrangler'

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
          HOLLWARE_PUBLIC_URL: 'http://localhost:5199',
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
    fsModuleCache: false,
  },
})
