import { defineConfig } from 'drizzle-kit'

// `drizzle-kit generate` only reads the schema and the snapshots in `out`: it never opens a
// database, so no `dbCredentials` are needed. The SQL files land where wrangler.jsonc points
// `migrations_dir`.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/schema.ts',
  out: './migrations',
})
