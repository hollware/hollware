import { inlineCodeSpans } from '../support/markdown.ts'
import type { TextFile, Violation } from './types.ts'

export interface AgentsPathsInput {
  docs: readonly TextFile[]
  exists: (path: string) => boolean
  ignored: (candidates: readonly string[]) => ReadonlySet<string>
  packages: ReadonlySet<string>
  basenames: ReadonlySet<string>
  missingAllowed: readonly string[]
}

const KNOWN_EXTENSIONS =
  /\.(?:md|mdx|ts|mts|cts|tsx|js|mjs|cjs|jsx|json|jsonc|yml|yaml|sql|sh|txt|toml|html|css)$/
const KNOWN_NAMES: ReadonlySet<string> = new Set([
  'LICENSE',
  'CODEOWNERS',
  '.node-version',
  '.gitignore',
  '.gitattributes',
])
const PATH_CHARACTERS = /^[\w.@+/-]+$/

export function claimedPath(token: string, packages: ReadonlySet<string>): string | undefined {
  if (!PATH_CHARACTERS.test(token)) return undefined
  if (token.startsWith('@') || token.startsWith('-')) return undefined
  if (token.startsWith('/')) return undefined
  const looksLikePath =
    token.includes('/') || KNOWN_EXTENSIONS.test(token) || KNOWN_NAMES.has(token)
  if (!looksLikePath) return undefined
  const first = token.split('/')[0] ?? ''
  if (token.includes('/') && packages.has(first)) return undefined
  return token.replace(/^\.\//, '').replace(/\/+$/, '')
}

function directoryOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? '' : path.slice(0, slash)
}

export function checkAgentsPaths(input: AgentsPathsInput): Violation[] {
  const violations: Violation[] = []
  const unresolved: { doc: TextFile; token: string; line: number; candidates: string[] }[] = []
  const usedExceptions = new Set<string>()

  for (const doc of input.docs) {
    const seen = new Set<string>()
    for (const span of inlineCodeSpans(doc.text)) {
      const path = claimedPath(span.text, input.packages)
      if (path === undefined || path === '' || seen.has(span.text)) continue
      seen.add(span.text)
      const directory = directoryOf(doc.path)
      const candidates = [directory === '' ? path : `${directory}/${path}`, path]
      if (candidates.some((candidate) => input.exists(candidate))) continue
      if (!path.includes('/') && input.basenames.has(path)) continue
      if (input.missingAllowed.includes(span.text)) {
        usedExceptions.add(span.text)
        continue
      }
      unresolved.push({ doc, token: span.text, line: span.line, candidates })
    }
  }

  const ignored = input.ignored(unresolved.flatMap((entry) => entry.candidates))
  for (const { doc, token, line, candidates } of unresolved) {
    if (candidates.some((candidate) => ignored.has(candidate))) continue
    violations.push({
      rule: 'agents-paths/missing',
      file: doc.path,
      message: `line ${line} mentions \`${token}\`, which is not a file or directory of the repository (checked ${directoryOf(doc.path) === '' ? 'at the root' : `relative to ${directoryOf(doc.path)} and to the root`}): fix the path, or add it to MISSING_DOC_PATHS if it cannot exist yet`,
    })
  }
  for (const entry of input.missingAllowed) {
    if (!usedExceptions.has(entry)) {
      violations.push({
        rule: 'agents-paths/stale-exception',
        file: 'tests/guards/exceptions.ts',
        message: `the allowed missing path \`${entry}\` is no longer needed (it exists, or nothing mentions it): remove it from MISSING_DOC_PATHS and lower its max`,
      })
    }
  }
  return violations
}
