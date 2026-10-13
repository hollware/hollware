import { readFileSync } from 'node:fs'

// Read at runtime, next to this module: `../package.json` is the package manifest
// both from `src/` and from the built `dist/`.
export function readVersion(): string {
  const manifest: { version?: unknown } = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  )
  if (typeof manifest.version !== 'string') throw new Error('package.json has no version')
  return manifest.version
}
