import { matchesGlob } from 'node:path'
import type { TextFile, Violation } from './types.ts'

export interface DocRefsInput {
  files: readonly TextFile[]
  allowed: readonly string[]
  frozen: readonly string[]
}

const GONE = new RegExp(
  [
    String.raw`\bA[D]R-\d+`,
    String.raw`\bT-\d{2,3}\b`,
    String.raw`docs/a[d]r`,
    String.raw`docs/desig[n]\.md`,
    String.raw`threat-mode[l]`,
    String.raw`docs/bran[d]\.md`,
  ].join('|'),
  'g',
)

export function checkDocRefs(input: DocRefsInput): Violation[] {
  const violations: Violation[] = []
  const frozen = new Set(input.frozen)
  const used = new Set<string>()
  for (const { path, text } of input.files) {
    if (frozen.has(path)) continue
    const lines = text.split('\n')
    const hits = lines.flatMap((line, index) =>
      [...line.matchAll(GONE)].map((match) => ({ line: index + 1, ref: match[0] })),
    )
    if (hits.length === 0) continue
    const glob = input.allowed.find((pattern) => matchesGlob(path, pattern))
    if (glob !== undefined) {
      used.add(glob)
      continue
    }
    for (const hit of hits) {
      violations.push({
        rule: 'doc-refs/gone',
        file: path,
        message: `line ${hit.line} cites "${hit.ref}", a document that no longer exists: say what it says, or drop it`,
      })
    }
  }
  for (const glob of input.allowed) {
    if (!used.has(glob)) {
      violations.push({
        rule: 'doc-refs/stale-exception',
        file: 'tests/guards/exceptions.ts',
        message: `DOC_REF_FILES: no file matching ${glob} cites a removed document: remove the entry`,
      })
    }
  }
  return violations
}
