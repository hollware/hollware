/**
 * Post-build check of the command-line packages. After `vp run -r build`, runs each built bin
 * of `packages/*` with `--version` and compares what it prints with `<bin> <version>`, the
 * version being the one in the package's own `package.json`:
 *
 *   node scripts/check-bins.ts
 *
 * It proves that the file npm will link as a bin exists, runs, and reads its own manifest.
 * The unit tests run without a build, so this is the only check that sees `dist/`.
 *
 * Exits 0 when every bin answers as expected, 1 when one does not or none is found.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export interface BinResult {
  /** The directory of the package, e.g. `packages/cli`. */
  dir: string
  bin: string
  ok: boolean
  /** One line for the report. */
  message: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** What a bin must print for `--version`. */
export function expectedVersionLine(bin: string, version: string): string {
  return `${bin} ${version}`
}

/**
 * The bins npm installs from a manifest, as `name -> path`. Inside the workspace `bin` points at
 * the source and `publishConfig.bin` at the build, which `pnpm pack` moves into `bin`
 * (ADR-016), so `publishConfig.bin` wins when there is one. A string `bin` is named after the
 * package.
 */
export function binsOf(manifest: unknown): Record<string, string> {
  if (!isRecord(manifest)) return {}
  const { name } = manifest
  const bin =
    (isRecord(manifest.publishConfig) ? manifest.publishConfig.bin : undefined) ?? manifest.bin
  if (typeof bin === 'string' && typeof name === 'string') {
    return { [name.slice(name.lastIndexOf('/') + 1)]: bin }
  }
  if (!isRecord(bin)) return {}
  return Object.fromEntries(
    Object.entries(bin).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}

/** Runs every bin of every `packages/*` of the repository at `root`. */
export function checkBins(root: string): BinResult[] {
  const results: BinResult[] = []
  const packages = join(root, 'packages')
  if (!existsSync(packages)) return results
  for (const name of readdirSync(packages).sort()) {
    const dir = `packages/${name}`
    const manifestPath = join(root, dir, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const version = isRecord(manifest) ? manifest.version : undefined
    for (const [bin, entry] of Object.entries(binsOf(manifest))) {
      const fail = (message: string): void => {
        results.push({ dir, bin, ok: false, message: `${bin} (${dir}): ${message}` })
      }
      if (typeof version !== 'string') {
        fail('package.json has no version')
        continue
      }
      const file = join(root, dir, entry)
      if (!existsSync(file)) {
        fail(`${entry} does not exist: run "vp run -r build" first`)
        continue
      }
      const run = spawnSync(process.execPath, [file, '--version'], { encoding: 'utf8' })
      if (run.error !== undefined) {
        fail(`could not run ${entry}: ${run.error.message}`)
        continue
      }
      const expected = expectedVersionLine(bin, version)
      const printed = run.stdout.trim()
      if (run.status !== 0) {
        fail(`${entry} --version exited with ${run.status}: ${run.stderr.trim()}`)
      } else if (printed !== expected) {
        fail(
          `${entry} --version printed ${JSON.stringify(printed)}, expected ${JSON.stringify(expected)}`,
        )
      } else {
        results.push({ dir, bin, ok: true, message: `ok  ${expected}` })
      }
    }
  }
  return results
}

export function main(root: string): number {
  const results = checkBins(root)
  if (results.length === 0) {
    console.error('check-bins: no bin found under packages/*')
    return 1
  }
  for (const result of results) {
    if (result.ok) console.log(result.message)
    else console.error(`FAIL ${result.message}`)
  }
  return results.every((result) => result.ok) ? 0 : 1
}

const invoked = process.argv[1]
if (invoked !== undefined && pathToFileURL(resolve(invoked)).href === import.meta.url) {
  process.exit(main(resolve(import.meta.dirname, '..')))
}
