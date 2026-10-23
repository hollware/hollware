import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SOURCE_DIR = fileURLToPath(new URL('../../src', import.meta.url))

export interface Install {
  module: string
  bin: string
  remove: () => void
}

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
