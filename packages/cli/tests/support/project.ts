import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach } from 'vite-plus/test'

export const WRANGLER_JSONC = `{
  // Not a real project: the shape of the starter's configuration.
  "name": "my-hollware",
  "compatibility_date": "2026-10-06",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "my-hollware",
      /* A placeholder id */
      "database_id": "00000000-0000-0000-0000-000000000000",
      "migrations_dir": "node_modules/@hollware/server/migrations",
    },
  ],
}
`

export interface TempDirs {
  make: (files?: Record<string, string>) => string
}

export function tempDirs(): TempDirs {
  const directories: string[] = []
  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })
  return {
    make: (files = {}) => {
      const directory = mkdtempSync(join(tmpdir(), 'hollware-cli-test-'))
      directories.push(directory)
      for (const [path, content] of Object.entries(files)) {
        const file = join(directory, path)
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, content)
      }
      return directory
    },
  }
}
