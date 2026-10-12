import { isDeepStrictEqual } from 'node:util'
import { isRecord, isStringArray, recordAt, stringAt } from '../support/values.ts'
import { HOMEPAGE_URL, ISSUES_URL, REPOSITORY_URL } from './project.ts'
import type { TextFile, Violation } from './types.ts'
import { parseManifests, type Manifest } from './workspace.ts'

/**
 * Guard `manifests`: every package of the workspace says what it is.
 *
 * A published package (`packages/*`) has the same shape as the five others: a name that
 * follows its directory, one shared version, MIT, the repository with its directory,
 * ESM, the files that ship, the `types`-first `exports`, public provenance publishing, an
 * engine range and the `build` and `publint` scripts. The apps, templates and examples
 * are private. Each published package also has a README and an AGENTS.md next to its
 * manifest.
 */

export interface ManifestsInput {
  /** The `package.json` of the root and of every workspace package. */
  manifests: readonly TextFile[]
  /** The repository files, to check what sits next to each manifest. */
  files: readonly string[]
}

/** Published packages whose name is not `@hollware/<directory>`. */
const UNSCOPED_NAMES: Readonly<Record<string, string>> = {
  cli: 'hollware',
  'create-hollware': 'create-hollware',
}

/** What `files` ships. Everything ships `dist`; the server also ships its D1 migrations. */
const SHIPPED_EXTRA: Readonly<Record<string, readonly string[]>> = {
  server: ['migrations'],
}

/** The executables a package installs. Only the two command-line packages have any. */
const BINS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  cli: { hollware: './dist/index.mjs' },
  'create-hollware': { 'create-hollware': './dist/index.mjs' },
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

  const exportsMap = recordAt(json, 'exports')
  const root = exportsMap?.['.']
  if (
    !isRecord(root) ||
    !isDeepStrictEqual(root, { types: './dist/index.d.mts', default: './dist/index.mjs' }) ||
    !isDeepStrictEqual(Object.keys(root), ['types', 'default'])
  ) {
    report(
      'exports',
      `exports["."] must be {"types":"./dist/index.d.mts","default":"./dist/index.mjs"} with "types" first, found ${show(root)}`,
    )
  }

  const bin = BINS[name]
  if (bin === undefined ? json.bin !== undefined : !isDeepStrictEqual(json.bin, bin)) {
    report(
      'bin',
      `"bin" must be ${bin === undefined ? 'absent' : show(bin)}, found ${show(json.bin)}`,
    )
  }

  if (!isDeepStrictEqual(json.publishConfig, { access: 'public', provenance: true })) {
    report(
      'publish-config',
      `"publishConfig" must be {"access":"public","provenance":true}, found ${show(json.publishConfig)}`,
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
  for (const manifest of published) violations.push(...checkPublished(manifest, files))

  // One version for the whole fixed group (ADR-013).
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

  // Everything else in the workspace, and the root, is never published.
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
