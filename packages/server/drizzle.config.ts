import { defineConfig } from 'drizzle-kit'

// `drizzle-kit generate` reads the schema and the snapshots in migrations/meta; it never opens a
// database. The SQL files land in migrations/, which the package ships (ADR-023).
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './migrations',
})
