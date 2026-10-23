import { readFileSync } from 'node:fs'

export function readVersion(): string {
  const manifest: { version?: unknown } = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  )
  if (typeof manifest.version !== 'string') throw new Error('package.json has no version')
  return manifest.version
}
