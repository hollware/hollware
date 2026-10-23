import { execFileSync, spawnSync } from 'node:child_process'
import { lstatSync, readdirSync, readFileSync, type Dirent } from 'node:fs'
import { dirname, join } from 'node:path'
import type { TextFile } from '../guards/types.ts'

export const REPO_ROOT = join(import.meta.dirname, '..', '..')

export function readText(path: string): string {
  return readFileSync(join(REPO_ROOT, path), 'utf8')
}

export function readBytes(path: string): Buffer {
  return readFileSync(join(REPO_ROOT, path))
}

export function readBytesIfExists(path: string): Buffer | undefined {
  return existsOnDisk(path) ? readBytes(path) : undefined
}

function existsOnDisk(path: string): boolean {
  try {
    lstatSync(join(REPO_ROOT, path))
    return true
  } catch {
    return false
  }
}

let filesCache: string[] | undefined

export function repoFiles(): readonly string[] {
  if (filesCache === undefined) {
    const output = execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
    )
    const names = new Set(output.split('\0').filter((name) => name !== ''))
    filesCache = [...names].filter(existsOnDisk).sort()
  }
  return filesCache
}

export function repoDirectories(): ReadonlySet<string> {
  const directories = new Set<string>()
  for (const file of repoFiles()) {
    let directory = dirname(file)
    while (directory !== '.' && !directories.has(directory)) {
      directories.add(directory)
      directory = dirname(directory)
    }
  }
  return directories
}

export function readRepoFiles(keep: (path: string) => boolean): TextFile[] {
  return repoFiles()
    .filter(keep)
    .map((path) => ({ path, text: readText(path) }))
}

export function readTextUnlessBinary(path: string): string | undefined {
  const bytes = readBytes(path)
  return bytes.includes(0) ? undefined : bytes.toString('utf8')
}

export function workingTreeFiles(root: string = REPO_ROOT): string[] {
  const found: string[] = []
  const visit = (directory: string): void => {
    let entries: Dirent[]
    try {
      entries = readdirSync(join(root, directory), { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      const path = directory === '' ? entry.name : `${directory}/${entry.name}`
      if (entry.isDirectory()) visit(path)
      else found.push(path)
    }
  }
  visit('')
  return found.sort()
}

export function ignoredByGit(candidates: readonly string[]): Set<string> {
  const probeOf = (candidate: string): string => {
    const segments = candidate.split('/')
    const index = segments.indexOf('node_modules')
    return index === -1 ? candidate : segments.slice(0, index + 1).join('/')
  }
  const probes = [...new Set(candidates.map(probeOf))]
  if (probes.length === 0) return new Set()
  const result = spawnSync('git', ['check-ignore', '--stdin', '-z'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    input: probes.join('\0'),
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`git check-ignore failed (${result.status}): ${result.stderr}`)
  }
  const ignored = new Set(result.stdout.split('\0').filter((name) => name !== ''))
  return new Set(candidates.filter((candidate) => ignored.has(probeOf(candidate))))
}

export function isWorkflowPath(path: string): boolean {
  return /^\.github\/workflows\/[^/]+\.ya?ml$/.test(path)
}

export function existsInRepository(path: string): boolean {
  return repoFiles().includes(path) || repoDirectories().has(path)
}

export function isAgentsFile(path: string): boolean {
  return path === 'AGENTS.md' || path.endsWith('/AGENTS.md')
}
