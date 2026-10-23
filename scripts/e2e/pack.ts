import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LocalPackage } from './registry.ts'

export const PUBLISHED = ['core', 'server', 'client', 'admin', 'nuxt', 'cli', 'create-hollware']

type Json = Record<string, unknown>

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function atVersion(manifest: Json, version: string, ours: ReadonlySet<string>): Json {
  const pin = (deps: unknown) =>
    isRecord(deps)
      ? Object.fromEntries(
          Object.entries(deps).map(([name, spec]) => [name, ours.has(name) ? version : spec]),
        )
      : deps
  return {
    ...manifest,
    version,
    ...(manifest['dependencies'] === undefined
      ? {}
      : { dependencies: pin(manifest['dependencies']) }),
    ...(manifest['devDependencies'] === undefined
      ? {}
      : { devDependencies: pin(manifest['devDependencies']) }),
    ...(manifest['peerDependencies'] === undefined
      ? {}
      : { peerDependencies: pin(manifest['peerDependencies']) }),
  }
}

export function packAll(root: string, version: string, out: string): LocalPackage[] {
  mkdirSync(out, { recursive: true })
  const names = PUBLISHED.map((dir) => {
    const manifest: unknown = JSON.parse(
      readFileSync(join(root, 'packages', dir, 'package.json'), 'utf8'),
    )
    return isRecord(manifest) ? String(manifest['name']) : dir
  })
  const ours = new Set(names)
  execFileSync('pnpm', ['exec', 'vp', 'run', '-r', 'build'], { cwd: root, stdio: 'inherit' })
  return PUBLISHED.map((dir) => {
    const work = mkdtempSync(join(tmpdir(), 'hollware-pack-'))
    try {
      execFileSync('pnpm', ['pack', '--pack-destination', work], {
        cwd: join(root, 'packages', dir),
        stdio: 'pipe',
      })
      const [packed] = readdirSync(work).filter((file) => file.endsWith('.tgz'))
      if (packed === undefined) throw new Error(`pnpm pack wrote no tarball for packages/${dir}`)
      execFileSync('tar', ['xzf', packed], { cwd: work })
      const manifestPath = join(work, 'package', 'package.json')
      const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
      if (!isRecord(manifest)) throw new Error(`packages/${dir} packed no package.json`)
      const versioned = atVersion(manifest, version, ours)
      writeFileSync(manifestPath, `${JSON.stringify(versioned, null, 2)}\n`)
      const name = String(versioned['name'])
      const file = join(out, `${name.replace('@', '').replace('/', '-')}-${version}.tgz`)
      execFileSync('tar', ['czf', file, 'package'], {
        cwd: work,
        env: { ...process.env, COPYFILE_DISABLE: '1' },
      })
      return { name, version, manifest: versioned, file }
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
  })
}
