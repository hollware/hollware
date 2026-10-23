import { isDeepStrictEqual } from 'node:util'
import { parseJsonc } from '../support/jsonc.ts'
import { isRecord, isStringArray, recordAt, stringAt } from '../support/values.ts'
import { HOMEPAGE_URL, ISSUES_URL, REPOSITORY_URL } from './project.ts'
import type { TextFile, Violation } from './types.ts'
import { parseManifests, type Manifest } from './workspace.ts'

export interface ManifestsInput {
  manifests: readonly TextFile[]
  files: readonly string[]
  devExports: Readonly<Record<string, unknown>>
}

const UNSCOPED_NAMES: Readonly<Record<string, string>> = {
  cli: 'hollware',
  'create-hollware': 'create-hollware',
}

const SHIPPED_EXTRA: Readonly<Record<string, readonly string[]>> = {
  server: ['migrations'],
  'create-hollware': ['template'],
  astro: ['components'],
}

const SOURCE_FILES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  astro: {
    './HollwareContent.astro': './components/HollwareContent.astro',
    './HollwareImage.astro': './components/HollwareImage.astro',
  },
}

const BIN_NAMES: Readonly<Record<string, string>> = {
  cli: 'hollware',
  'create-hollware': 'create-hollware',
}

const SUBPATHS: Readonly<Record<string, readonly string[]>> = {
  client: ['webhooks'],
  core: ['webhooks'],
}

function sourceExports(name: string): Record<string, unknown> {
  return {
    '.': './src/index.ts',
    ...Object.fromEntries((SUBPATHS[name] ?? []).map((sub) => [`./${sub}`, `./src/${sub}.ts`])),
    ...SOURCE_FILES[name],
    './package.json': './package.json',
  }
}

function publishedExportsOf(name: string): Record<string, unknown> {
  const built = (entry: string) => ({
    types: `./dist/${entry}.d.mts`,
    default: `./dist/${entry}.mjs`,
  })
  return {
    '.': built('index'),
    ...Object.fromEntries((SUBPATHS[name] ?? []).map((sub) => [`./${sub}`, built(sub)])),
    ...SOURCE_FILES[name],
    './package.json': './package.json',
  }
}

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

function show(value: unknown): string {
  return JSON.stringify(value) ?? 'undefined'
}

function directoryName(manifest: Manifest): string {
  return manifest.dir.slice('packages/'.length)
}

function checkPublished(manifest: Manifest, files: ReadonlySet<string>): Violation[] {
  const violations: Violation[] = []
  const { json, path, dir } = manifest
  const name = directoryName(manifest)
  const report = (rule: string, message: string): void => {
    violations.push({ rule: `manifest/${rule}`, file: path, message })
  }

  const expectedName = UNSCOPED_NAMES[name] ?? `@hollware/${name}`
  if (json.name !== expectedName) {
    report(
      'name',
      `"name" must be ${show(expectedName)} (the package of ${dir}), found ${show(json.name)}`,
    )
  }
  if (typeof json.version !== 'string' || !SEMVER.test(json.version)) {
    report(
      'version',
      `"version" must be a semantic version such as "0.0.0", found ${show(json.version)}`,
    )
  }
  if (typeof json.description !== 'string' || json.description.trim() === '') {
    report('description', '"description" must be a non-empty string')
  }
  if (json.homepage !== HOMEPAGE_URL) {
    report('homepage', `"homepage" must be ${show(HOMEPAGE_URL)}, found ${show(json.homepage)}`)
  }
  if (!isDeepStrictEqual(json.bugs, { url: ISSUES_URL })) {
    report('bugs', `"bugs" must be ${show({ url: ISSUES_URL })}, found ${show(json.bugs)}`)
  }
  if (json.license !== 'MIT') {
    report('license', `"license" must be "MIT", found ${show(json.license)}`)
  }
  const repository = { type: 'git', url: REPOSITORY_URL, directory: dir }
  if (!isDeepStrictEqual(json.repository, repository)) {
    report('repository', `"repository" must be ${show(repository)}, found ${show(json.repository)}`)
  }
  if (json.type !== 'module') {
    report('type', `"type" must be "module", found ${show(json.type)}`)
  }
  if (json.private === true) {
    report(
      'private',
      'a published package must not be "private": true, or it can never be released',
    )
  }

  const shipped = ['dist', ...(SHIPPED_EXTRA[name] ?? [])]
  const found = isStringArray(json.files) ? json.files : undefined
  if (found === undefined || !isDeepStrictEqual([...found].sort(), [...shipped].sort())) {
    report('files', `"files" must list exactly ${show(shipped)}, found ${show(json.files)}`)
  }

  const SOURCE_EXPORTS = sourceExports(name)
  if (!isDeepStrictEqual(json.exports, SOURCE_EXPORTS)) {
    report(
      'exports',
      `"exports" must be ${show(SOURCE_EXPORTS)}: inside the workspace a package resolves to its source, found ${show(json.exports)}`,
    )
  }

  const {
    exports: publishedExports,
    bin: publishedBin,
    ...settings
  } = recordAt(json, 'publishConfig') ?? {}
  if (!isDeepStrictEqual(settings, { access: 'public', provenance: true })) {
    report(
      'publish-config',
      `"publishConfig" must hold {"access":"public","provenance":true} and nothing else besides "exports" and "bin", found ${show(json.publishConfig)}`,
    )
  }
  const PUBLISHED_EXPORTS = publishedExportsOf(name)
  const typesFirst =
    isRecord(publishedExports) &&
    Object.entries(publishedExports)
      .filter(([key]) => key !== './package.json' && !Object.hasOwn(SOURCE_FILES[name] ?? {}, key))
      .every(
        ([, entry]) =>
          isRecord(entry) && isDeepStrictEqual(Object.keys(entry), ['types', 'default']),
      )
  if (!isDeepStrictEqual(publishedExports, PUBLISHED_EXPORTS) || !typesFirst) {
    report(
      'published-exports',
      `"publishConfig.exports" must be ${show(PUBLISHED_EXPORTS)} with "types" first, found ${show(publishedExports)}`,
    )
  }

  const binName = BIN_NAMES[name]
  const sourceBin = binName === undefined ? undefined : { [binName]: './src/index.ts' }
  const builtBin = binName === undefined ? undefined : { [binName]: './dist/index.mjs' }
  if (!isDeepStrictEqual(json.bin, sourceBin)) {
    report(
      'bin',
      `"bin" must be ${sourceBin === undefined ? 'absent' : show(sourceBin)}, found ${show(json.bin)}`,
    )
  }
  if (!isDeepStrictEqual(publishedBin, builtBin)) {
    report(
      'published-bin',
      `"publishConfig.bin" must be ${builtBin === undefined ? 'absent' : show(builtBin)}, found ${show(publishedBin)}`,
    )
  }

  const engines = stringAt(recordAt(json, 'engines'), 'node')
  if (engines === undefined || engines.trim() === '') {
    report('engines', '"engines.node" must be a non-empty range such as ">=24.11.0"')
  }

  const scripts = recordAt(json, 'scripts')
  for (const script of ['build', 'publint']) {
    const command = scripts?.[script]
    if (typeof command !== 'string' || command.trim() === '') {
      report('scripts', `"scripts.${script}" must be a non-empty command, found ${show(command)}`)
    }
  }

  for (const required of ['README.md', 'AGENTS.md']) {
    if (!files.has(`${dir}/${required}`)) {
      report('missing-file', `${dir}/${required} is missing: every published package has one`)
    }
  }
  return violations
}

export function checkManifests(input: ManifestsInput): Violation[] {
  const { manifests, violations } = parseManifests(input.manifests)
  const files = new Set(input.files)

  const published = manifests.filter((manifest) => /^packages\/[^/]+$/.test(manifest.dir))
  for (const manifest of published) {
    violations.push(...checkPublished(manifest, files))
    const devExports = input.devExports[manifest.dir]
    if (devExports !== true) {
      violations.push({
        rule: 'manifest/dev-exports',
        file: `${manifest.dir}/vite.config.ts`,
        message: `"pack.exports.devExports" must be true, or the next \`vp pack\` points the manifest at dist again, found ${show(devExports)}`,
      })
    }
  }

  const versions = new Set(published.map((manifest) => show(manifest.json.version)))
  if (versions.size > 1) {
    for (const manifest of published) {
      violations.push({
        rule: 'manifest/version-mismatch',
        file: manifest.path,
        message: `the published packages share one version, but the versions found are ${[...versions].join(', ')}`,
      })
    }
  }

  for (const manifest of manifests) {
    if (/^packages\/[^/]+$/.test(manifest.dir)) continue
    if (manifest.json.private !== true) {
      violations.push({
        rule: 'manifest/private',
        file: manifest.path,
        message: '"private" must be true: only the packages in packages/ are published',
      })
    }
  }
  return violations
}

export function checkBaseTsconfig(tsconfig: TextFile): Violation[] {
  const parsed = parseJsonc(tsconfig.text)
  const value = parsed.ok
    ? recordAt(parsed.value, 'compilerOptions')?.erasableSyntaxOnly
    : undefined
  if (value === true) return []
  return [
    {
      rule: 'manifest/erasable-syntax',
      file: tsconfig.path,
      message: `"compilerOptions.erasableSyntaxOnly" must be true, so Node.js runs every source as it is, found ${show(value)}`,
    },
  ]
}
