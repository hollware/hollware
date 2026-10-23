import { parse } from 'yaml'
import { workspaceManifestPaths } from '../guards/workspace.ts'
import type { TextFile } from '../guards/types.ts'
import { isRecord, isStringArray } from './values.ts'
import { readText, repoFiles } from './repo.ts'

export function workspaceGlobs(): string[] {
  const workspace: unknown = parse(readText('pnpm-workspace.yaml'))
  const packages = isRecord(workspace) ? workspace.packages : undefined
  if (!isStringArray(packages)) {
    throw new Error('pnpm-workspace.yaml must list its packages')
  }
  return packages
}

export function workspaceManifests(): TextFile[] {
  const { paths, unsupportedGlobs } = workspaceManifestPaths(workspaceGlobs(), repoFiles())
  if (unsupportedGlobs.length > 0) {
    throw new Error(
      `pnpm-workspace.yaml uses globs the guards cannot expand: ${unsupportedGlobs.join(', ')}. Teach workspaceManifestPaths about them.`,
    )
  }
  return paths.map((path) => ({ path, text: readText(path) }))
}
