import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SOURCE_DIR = fileURLToPath(new URL('../../src', import.meta.url))

export interface Install {
  /** The copy of `src/index.ts`, at `<root>/src/index.ts`. */
  module: string
  /** A symlink to the module at `<root>/bin/create-hollware`, the way npm links a bin. */
  bin: string
  remove: () => void
}

/**
 * A throwaway install of the CLI: `src/` copied next to a `package.json` the test
 * controls, so the version the CLI must read is known, plus a bin symlink.
 */
export function install(manifest: object): Install {
  const root = mkdtempSync(join(tmpdir(), 'create-hollware-'))
  cpSync(SOURCE_DIR, join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module', ...manifest }))
  mkdirSync(join(root, 'bin'))
  const module = join(root, 'src', 'index.ts')
  const bin = join(root, 'bin', 'create-hollware')
  symlinkSync(module, bin)
  return { module, bin, remove: () => rmSync(root, { recursive: true, force: true }) }
}
