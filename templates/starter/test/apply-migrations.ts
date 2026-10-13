import { applyD1Migrations } from 'cloudflare:test'
import { env } from 'cloudflare:workers'

// Setup files run before every test file. `applyD1Migrations` skips what is already applied.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
