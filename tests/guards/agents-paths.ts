import { inlineCodeSpans } from '../support/markdown.ts'
import type { TextFile, Violation } from './types.ts'

/**
 * Guard `agents-paths`: a path that an `AGENTS.md` or a `README.md` puts in backticks exists.
 * Docs that point at files that moved send the next reader, human or agent, in the wrong
 * direction.
 *
 * A backticked token is taken for a path when it has no space and holds only path characters
 * (letters, digits, `_ . - / + @`) and either has a `/`, ends with a known file extension, or
 * is a known extensionless name (`LICENSE`, `.node-version`). It is not checked when it is:
 * a command (it has a space), a glob or a placeholder (`*`, `<name>`), a URL or a module
 * specifier (`:`), an npm scope (`@scope/name`), or a subpath of a package (`vite-plus/test`,
 * the first segment is a package the workspace knows). Fenced blocks are skipped.
 *
 * A path exists when it resolves relative to the directory of the file that mentions it, or
 * relative to the repository root, as a file or a directory. A bare file name (`release.yml`)
 * also resolves when some file of the repository has that name. A path that `.gitignore`
 * ignores (`dist/`, `node_modules/...`) is build output and exists only after a build, so it
 * is not checked.
 *
 * Paths that cannot exist yet, or that name something outside the repository, are allowed by
 * name. The list may only shrink, and an entry whose path now resolves is reported as stale.
 */

export interface AgentsPathsInput {
  /** The `AGENTS.md` and `README.md` files, with their text. */
  docs: readonly TextFile[]
  /** Whether a repository-relative path is a file or a directory of the repository. */
  exists: (path: string) => boolean
  /** The paths, among the candidates, that `.gitignore` ignores. */
  ignored: (candidates: readonly string[]) => ReadonlySet<string>
  /** Package names (the workspace's and its dependencies'), whose subpaths are not paths. */
  packages: ReadonlySet<string>
  /** The names of the files of the repository, for bare file names. */
  basenames: ReadonlySet<string>
  /** Allowed paths that do not exist, as the text between the backticks. */
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

/** The repository path a backticked token claims, or `undefined` when it claims none. */
export function claimedPath(token: string, packages: ReadonlySet<string>): string | undefined {
  if (!PATH_CHARACTERS.test(token)) return undefined
  if (token.startsWith('@') || token.startsWith('-')) return undefined
  // A route of a Worker (`/mcp`, `/health`) or an absolute path: never a path of the repository.
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
