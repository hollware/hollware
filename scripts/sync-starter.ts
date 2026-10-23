import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse } from 'yaml'

export const VERSION_PLACEHOLDER = 'HOLLWARE_VERSION'

export const TEMPLATE_DIR = join('packages', 'create-hollware', 'template')

const STARTER_DIR = join('templates', 'starter')
const SKIPPED = new Set(['node_modules', 'dist', '.wrangler', 'package.json', 'tsconfig.json'])

type Json = Record<string, unknown>

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function filesBelow(root: string, skipped: ReadonlySet<string>, directory = root): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => !(directory === root && skipped.has(entry.name)))
    .flatMap((entry) => {
      const path = join(directory, entry.name)
      return entry.isDirectory() ? filesBelow(root, skipped, path) : [relative(root, path)]
    })
    .sort()
}

export function templateManifest(starter: Json, catalog: Record<string, string>): Json {
  const pin = (deps: unknown): Record<string, string> => {
    if (!isRecord(deps)) return {}
    return Object.fromEntries(
      Object.entries(deps).map(([name, spec]) => {
        if (spec === 'workspace:*') return [name, VERSION_PLACEHOLDER]
        if (spec === 'catalog:') {
          const version = catalog[name]
          if (version === undefined) throw new Error(`${name} is not in the catalog`)
          return [name, version]
        }
        throw new Error(`${name} of the starter is "${String(spec)}": use workspace:* or catalog:`)
      }),
    )
  }
  return {
    name: 'my-hollware',
    version: '0.0.0',
    private: true,
    type: 'module',
    scripts: starter['scripts'],
    dependencies: pin(starter['dependencies']),
    devDependencies: pin(starter['devDependencies']),
    ...(starter['overrides'] === undefined ? {} : { overrides: starter['overrides'] }),
  }
}

export function templateTsconfig(base: Json, starter: Json): Json {
  const own = isRecord(starter['compilerOptions']) ? starter['compilerOptions'] : {}
  const shared = isRecord(base['compilerOptions']) ? base['compilerOptions'] : {}
  return { compilerOptions: { ...shared, ...own }, include: starter['include'] }
}

export function starterTemplate(root: string): Map<string, string> {
  const starter = join(root, STARTER_DIR)
  const read = (path: string): string => readFileSync(join(root, path), 'utf8')
  const json = (path: string): Json => {
    const value: unknown = JSON.parse(read(path))
    if (!isRecord(value)) throw new Error(`${path} holds no object`)
    return value
  }
  const workspace: unknown = parse(read('pnpm-workspace.yaml'))
  const catalog =
    isRecord(workspace) && isRecord(workspace['catalog']) ? workspace['catalog'] : undefined
  if (catalog === undefined) throw new Error('pnpm-workspace.yaml has no catalog')
  const versions = Object.fromEntries(
    Object.entries(catalog).map(([name, version]) => [name, String(version)]),
  )
  const files = new Map<string, string>()
  for (const path of filesBelow(starter, SKIPPED))
    files.set(path, readFileSync(join(starter, path), 'utf8'))
  const stringify = (value: Json) => `${JSON.stringify(value, null, 2)}\n`
  files.set(
    'package.json',
    stringify(templateManifest(json(join(STARTER_DIR, 'package.json')), versions)),
  )
  files.set(
    'tsconfig.json',
    stringify(
      templateTsconfig(json('tsconfig.base.json'), json(join(STARTER_DIR, 'tsconfig.json'))),
    ),
  )
  return new Map([...files.entries()].sort(([a], [b]) => a.localeCompare(b)))
}

function write(root: string): void {
  const directory = join(root, TEMPLATE_DIR)
  rmSync(directory, { recursive: true, force: true })
  for (const [path, content] of starterTemplate(root)) {
    mkdirSync(dirname(join(directory, path)), { recursive: true })
    writeFileSync(join(directory, path), content)
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const root = resolve(import.meta.dirname, '..')
  write(root)
  process.stdout.write(`Wrote ${TEMPLATE_DIR} from ${STARTER_DIR}.\n`)
}
