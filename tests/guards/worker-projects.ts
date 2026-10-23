import { isRecord } from '../support/values.ts'
import type { TextFile, Violation } from './types.ts'
import { parseManifests, type Manifest } from './workspace.ts'

export interface WorkerProjectsInput {
  configs: readonly string[]
  manifests: readonly TextFile[]
}

export function isWorkerConfig(path: string): boolean {
  return /(?:^|\/)wrangler\.(?:json|jsonc|toml)$/.test(path)
}

function ownerOf(config: string, manifests: readonly Manifest[]): Manifest | undefined {
  let best: Manifest | undefined
  for (const candidate of manifests) {
    const inside = candidate.dir === '' || config.startsWith(`${candidate.dir}/`)
    if (inside && (best === undefined || candidate.dir.length > best.dir.length)) best = candidate
  }
  return best
}

function scriptsOf(manifest: Manifest): Record<string, string> {
  const found: Record<string, string> = {}
  const scripts: unknown = manifest.json.scripts
  if (!isRecord(scripts)) return found
  for (const [name, script] of Object.entries(scripts)) {
    if (typeof script === 'string' && script.trim() !== '') found[name] = script
  }
  return found
}

function namesPath(script: string, path: string): boolean {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|[\\s"'=])(?:\\./)?${escaped}(?=$|[\\s"';&|)])`).test(script)
}

export function checkWorkerProjects(input: WorkerProjectsInput): Violation[] {
  const { manifests, violations } = parseManifests(input.manifests)
  const owned = new Map<string, { manifest: Manifest; configs: string[] }>()
  for (const config of input.configs) {
    const manifest = ownerOf(config, manifests)
    if (manifest === undefined) {
      violations.push({
        rule: 'worker-projects/no-project',
        file: config,
        message:
          'no workspace package contains this Worker config: move it into one, whose build and types:check scripts then cover it',
      })
      continue
    }
    const project = owned.get(manifest.path) ?? { manifest, configs: [] }
    project.configs.push(config)
    owned.set(manifest.path, project)
  }

  for (const { manifest, configs } of owned.values()) {
    const scripts = scriptsOf(manifest)
    const name = typeof manifest.json.name === 'string' ? manifest.json.name : manifest.path
    const owns = `${name} owns the Worker config ${configs.join(', ')}`
    if (scripts.build === undefined) {
      violations.push({
        rule: 'worker-projects/no-build',
        file: manifest.path,
        message: `${owns} but defines no "build" script: vp run -r build never builds this Worker`,
      })
    }
    const typesCheck = scripts['types:check']
    if (typesCheck === undefined) {
      violations.push({
        rule: 'worker-projects/no-types-check',
        file: manifest.path,
        message: `${owns} but defines no "types:check" script: vp run -r types:check never checks its generated types`,
      })
      continue
    }
    for (const config of configs) {
      const relative = manifest.dir === '' ? config : config.slice(manifest.dir.length + 1)
      if (relative.includes('/') && !namesPath(typesCheck, relative)) {
        violations.push({
          rule: 'worker-projects/types-check-config',
          file: manifest.path,
          message: `the types:check script of ${name} does not name ${relative}, a Worker config below the package directory: add -c ${relative} to its wrangler types --check, or the generated types of that Worker are never checked`,
        })
      }
    }
  }
  return violations
}
