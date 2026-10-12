import { isDeepStrictEqual } from 'node:util'
import { isRecord, isStringArray, parseJson } from '../support/values.ts'
import type { TextFile, Violation } from './types.ts'
import { isPublishable, parseManifests } from './workspace.ts'

/**
 * Guard `changesets`: the six published packages share one version because
 * `.changeset/config.json` fixes them as one group (ADR-013). The `fixed` list holds exactly
 * one group, and the group is exactly the set of non-private packages of `packages/`. The
 * config also publishes with public access from `main`, and never versions or tags the
 * private apps and templates.
 */

export interface ChangesetsInput {
  /** `.changeset/config.json`. */
  config: TextFile
  /** The `package.json` of the root and of every workspace package. */
  manifests: readonly TextFile[]
}

export function checkChangesets(input: ChangesetsInput): Violation[] {
  const { manifests, violations } = parseManifests(input.manifests)
  const file = input.config.path
  const report = (rule: string, message: string): void => {
    violations.push({ rule: `changesets/${rule}`, file, message })
  }

  const parsed = parseJson(input.config.text)
  if (!parsed.ok || !isRecord(parsed.value)) {
    report('invalid-json', 'the changeset config must be a JSON object')
    return violations
  }
  const config = parsed.value

  const published = manifests
    .filter((manifest) => isPublishable(manifest))
    .map((manifest) => manifest.json.name)
    .filter((name): name is string => typeof name === 'string')
    .sort()
  const fixed = config.fixed
  if (!Array.isArray(fixed) || fixed.length !== 1 || !isStringArray(fixed[0])) {
    report(
      'fixed',
      `"fixed" must hold exactly one group of package names, found ${JSON.stringify(fixed)}`,
    )
  } else {
    const group = [...fixed[0]].sort()
    if (!isDeepStrictEqual(group, published)) {
      report(
        'fixed',
        `the fixed group must be exactly the published packages ${JSON.stringify(published)}, found ${JSON.stringify(group)}`,
      )
    }
  }
  if (config.access !== 'public') {
    report('access', `"access" must be "public", found ${JSON.stringify(config.access)}`)
  }
  if (config.baseBranch !== 'main') {
    report('base-branch', `"baseBranch" must be "main", found ${JSON.stringify(config.baseBranch)}`)
  }
  if (!isDeepStrictEqual(config.privatePackages, { version: false, tag: false })) {
    report(
      'private-packages',
      `"privatePackages" must be {"version":false,"tag":false}, found ${JSON.stringify(config.privatePackages)}`,
    )
  }
  return violations
}
