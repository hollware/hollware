/**
 * The public API of Hollware, as what 1.0 promises (ADR-036) reads it from the code: every MCP tool
 * with its scopes, effect and schemas, the read API's OpenAPI document, the methods of the RPC
 * entrypoint, the events webhooks get, the commands and flags of the CLI, the names each published
 * package exports, and the hash of every migration. `api/` holds it as JSON, one file per part;
 * the guard `public-api` fails when the code and `api/` differ, so a change of the public API is
 * always in the diff of the change that makes it.
 *
 *   node scripts/api.ts           says whether api/ is current
 *   node scripts/api.ts --write   writes api/ from the code
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { parseSync } from 'vite-plus'

/** One part of the public API: the file of `api/` and what it holds. */
export type Surface = Readonly<Record<string, unknown>>

/** A node of the tree oxc parses: only the fields read here. */
interface Node {
  readonly type: string
  readonly [key: string]: unknown
}

const isNode = (value: unknown): value is Node =>
  typeof value === 'object' && value !== null && typeof Reflect.get(value, 'type') === 'string'

function programOf(path: string, text: string): Node[] {
  const { program } = parseSync(path, text)
  return (program.body as unknown[]).filter(isNode)
}

function walk(node: unknown, visit: (node: Node) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  if (!isNode(node)) return
  visit(node)
  for (const value of Object.values(node)) {
    if (typeof value === 'object' && value !== null) walk(value, visit)
  }
}

const nameOf = (node: unknown): string | undefined => {
  if (!isNode(node)) return undefined
  const name = node['name'] ?? node['value']
  return typeof name === 'string' ? name : undefined
}

/** Keys sorted all the way down, so the JSON of a part depends on nothing but its content. */
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sorted(Reflect.get(value, key))]),
  )
}

/**
 * The names a module exports, each `value` or `type`, following `export *` and `export … from`
 * into the modules of the same package. A name exported both ways (a const and its type) is a value.
 */
export function exportsOf(
  file: string,
  read: (path: string) => string,
  seen = new Set<string>(),
): Map<string, 'value' | 'type'> {
  const names = new Map<string, 'value' | 'type'>()
  if (seen.has(file)) return names
  seen.add(file)
  const add = (name: string, kind: 'value' | 'type') => {
    if (names.get(name) !== 'value') names.set(name, kind)
  }
  for (const node of programOf(file, read(file))) {
    if (node.type === 'ExportAllDeclaration') {
      const source = nameOf(node['source'])
      if (source === undefined || !source.startsWith('.')) continue
      const exported = nameOf(node['exported'])
      if (exported !== undefined) {
        add(exported, 'value')
        continue
      }
      for (const [name, kind] of exportsOf(resolve(dirname(file), source), read, seen)) {
        if (name !== 'default') add(name, kind)
      }
    }
    if (node.type !== 'ExportNamedDeclaration') continue
    const statementKind = node['exportKind'] === 'type' ? 'type' : 'value'
    const declaration = node['declaration']
    if (isNode(declaration)) {
      const kind = declaration.type.startsWith('TS') ? 'type' : statementKind
      if (declaration.type === 'VariableDeclaration') {
        for (const declarator of (declaration['declarations'] as unknown[]) ?? []) {
          const name = isNode(declarator) ? nameOf(declarator['id']) : undefined
          if (name !== undefined) add(name, 'value')
        }
      } else {
        const name = nameOf(declaration['id'])
        if (name !== undefined) add(name, kind === 'type' ? 'type' : 'value')
      }
    }
    for (const specifier of (node['specifiers'] as unknown[]) ?? []) {
      if (!isNode(specifier)) continue
      const name = nameOf(specifier['exported'])
      const kind = statementKind === 'type' || specifier['exportKind'] === 'type' ? 'type' : 'value'
      if (name !== undefined) add(name, kind)
    }
  }
  return names
}

/** The published packages: their name, their directory, and the source of each entry. */
function packagesOf(root: string) {
  return readdirSync(join(root, 'packages'))
    .map((dir) => join(root, 'packages', dir))
    .filter((dir) => existsSync(join(dir, 'package.json')))
    .map((dir) => ({ dir, manifest: JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) }))
    .filter(({ manifest }) => manifest.private !== true)
    .sort((a, b) => String(a.manifest.name).localeCompare(String(b.manifest.name)))
}

function exportsSurface(root: string): Surface {
  const read = (path: string) => readFileSync(path, 'utf8')
  const out: Record<string, Record<string, Record<string, string>>> = {}
  for (const { dir, manifest } of packagesOf(root)) {
    const entries: Record<string, Record<string, string>> = {}
    for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
      if (typeof target !== 'string' || !/\.tsx?$/.test(target)) continue
      entries[subpath] = Object.fromEntries(exportsOf(resolve(dir, target), read))
    }
    if (Object.keys(entries).length > 0) out[manifest.name] = entries
  }
  return out
}

/** Every method of the RPC entrypoint, with its signature as the source writes it. */
function rpcSurface(root: string): Surface {
  const file = join(root, 'packages/server/src/index.ts')
  const text = readFileSync(file, 'utf8')
  const methods: Record<string, string> = {}
  walk(programOf(file, text), (node) => {
    if (node.type !== 'TSInterfaceDeclaration' || nameOf(node['id']) !== 'HollwareRpc') return
    walk(node['body'], (member) => {
      if (member.type !== 'TSMethodSignature') return
      const name = nameOf(member['key'])
      const start = Number(member['start'])
      const end = Number(member['end'])
      if (name === undefined) return
      methods[name] = text
        .slice(start, end)
        .replace(/\/\*\*[\s\S]*?\*\//g, '')
        .replace(/\s+/g, ' ')
        .replace(/,\s*([)}\]])/g, '$1')
        .trim()
    })
  })
  return methods
}

/** The commands of the CLI, and the flags each of its option parsers takes, file by file. */
function cliSurface(root: string): Surface {
  const index = join(root, 'packages/cli/src/index.ts')
  const commands: string[] = []
  walk(programOf(index, readFileSync(index, 'utf8')), (node) => {
    if (node.type !== 'VariableDeclarator' || nameOf(node['id']) !== 'COMMANDS') return
    walk(node['init'], (property) => {
      if (property.type === 'Property' && nameOf(property['key']) === 'name') {
        const name = nameOf(property['value'])
        if (name !== undefined) commands.push(name)
      }
    })
  })
  const flags: Record<string, unknown[]> = {}
  const dir = join(root, 'packages/cli/src/commands')
  for (const file of readdirSync(dir)
    .filter((name) => name.endsWith('.ts'))
    .sort()) {
    const parsers: unknown[] = []
    walk(programOf(file, readFileSync(join(dir, file), 'utf8')), (node) => {
      if (node.type !== 'CallExpression' || nameOf(node['callee']) !== 'parseFlags') return
      const [config] = (node['arguments'] as unknown[]) ?? []
      if (!isNode(config)) return
      const options: Record<string, Record<string, unknown>> = {}
      for (const property of (config['properties'] as unknown[]) ?? []) {
        if (!isNode(property) || nameOf(property['key']) !== 'options') continue
        const value = property['value']
        if (!isNode(value)) continue
        for (const option of (value['properties'] as unknown[]) ?? []) {
          if (!isNode(option)) continue
          const name = nameOf(option['key'])
          const body = option['value']
          if (name === undefined || !isNode(body)) continue
          const described: Record<string, unknown> = {}
          for (const field of (body['properties'] as unknown[]) ?? []) {
            if (!isNode(field)) continue
            const key = nameOf(field['key'])
            const literal = field['value']
            if (
              (key === 'type' || key === 'short' || key === 'multiple') &&
              isNode(literal) &&
              literal.type === 'Literal'
            ) {
              described[key] = literal['value']
            }
          }
          options[name] = described
        }
      }
      parsers.push(options)
    })
    if (parsers.length > 0) flags[file.replace(/\.ts$/, '')] = parsers
  }
  return { commands: commands.sort(), flags }
}

function migrationsSurface(root: string): Surface {
  const dir = join(root, 'packages/server/migrations')
  return Object.fromEntries(
    readdirSync(dir)
      .filter((name) => name.endsWith('.sql'))
      .sort()
      .map((name) => [
        name,
        createHash('sha256')
          .update(readFileSync(join(dir, name)))
          .digest('hex'),
      ]),
  )
}

/** Every part of the public API, by the name of its file in `api/`. */
export async function surfaceOf(root: string): Promise<Record<string, Surface>> {
  const core = await import(pathToFileURL(join(root, 'packages/core/src/index.ts')).href)
  // The zod of @hollware/core, which made its schemas: the root of the repository declares none.
  const z: { toJSONSchema(schema: unknown, options: { io: 'input' | 'output' }): Surface } =
    await import(
      pathToFileURL(createRequire(join(root, 'packages/core/package.json')).resolve('zod')).href
    )
  const readApi = await import(
    pathToFileURL(join(root, 'packages/server/src/http/read-api.ts')).href
  )
  const tools = [...core.OPERATIONS]
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .map((operation) => ({
      name: operation.name,
      title: operation.title,
      scopes: [...operation.scopes].sort((a: string, b: string) => a.localeCompare(b)),
      effect: operation.effect,
      input: z.toJSONSchema(operation.input, { io: 'input' }),
      output: z.toJSONSchema(operation.output, { io: 'output' }),
    }))
  const parts: Record<string, Surface> = {
    'mcp.json': { tools },
    'http.json': readApi.openApiDocument(),
    'rpc.json': rpcSurface(root),
    'events.json': z.toJSONSchema(core.hollwareEvent, { io: 'output' }),
    'cli.json': cliSurface(root),
    'exports.json': exportsSurface(root),
    'migrations.json': migrationsSurface(root),
  }
  return Object.fromEntries(
    Object.entries(parts).map(([file, part]) => [file, sorted(part) as Surface]),
  )
}

/** The text of a part, as `api/` holds it. */
export const textOf = (part: Surface): string => `${JSON.stringify(part, null, 2)}\n`

/** The files of `api/` that differ from the code, or are missing. */
export async function staleParts(root: string): Promise<string[]> {
  const parts = await surfaceOf(root)
  return Object.entries(parts)
    .filter(([file, part]) => {
      const path = join(root, 'api', file)
      // Compared as JSON, not as text: the formatter of the repository lays api/ out its own way.
      return !existsSync(path) || !isDeepStrictEqual(JSON.parse(readFileSync(path, 'utf8')), part)
    })
    .map(([file]) => file)
}

export async function main(root: string, argv: readonly string[]): Promise<number> {
  if (argv.includes('--write')) {
    mkdirSync(join(root, 'api'), { recursive: true })
    for (const [file, part] of Object.entries(await surfaceOf(root))) {
      writeFileSync(join(root, 'api', file), textOf(part))
    }
    console.log('Wrote api/ from the code.')
    return 0
  }
  const stale = await staleParts(root)
  if (stale.length === 0) {
    console.log('api/ is the public API of the code.')
    return 0
  }
  console.error(
    `api/ differs from the code in ${stale.join(', ')}: run "node scripts/api.ts --write" and commit what changed.`,
  )
  return 1
}

const invoked = process.argv[1]
if (invoked !== undefined && pathToFileURL(resolve(invoked)).href === import.meta.url) {
  main(resolve(import.meta.dirname, '..'), process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error)
      process.exit(1)
    },
  )
}
