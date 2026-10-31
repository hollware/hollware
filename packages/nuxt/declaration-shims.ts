import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function writeDeclarationShims(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.d.mts')) continue
    const name = entry.name.slice(0, -'.d.mts'.length)
    writeFileSync(join(entry.parentPath, `${name}.d.ts`), `export * from './${name}.mjs'\n`)
  }
}

export function shimRuntimeDeclarations(config: { readonly outDir: string }): void {
  writeDeclarationShims(config.outDir)
}
