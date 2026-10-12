import { headings, stripFencedBlocks } from '../support/markdown.ts'
import type { TextFile, Violation } from './types.ts'

/**
 * Guard `markdown-links`: a relative link in a Markdown file leads somewhere. The file or
 * directory it names exists, and when it ends with `#anchor` and names a Markdown file, that
 * file has a heading with that anchor (GitHub's rule: lowercase, punctuation dropped, spaces
 * to hyphens, a repeated heading gets `-1`, `-2`).
 *
 * Inline links, images and reference definitions are read; fenced blocks and inline code are
 * not. Absolute URLs and `mailto:` links are not followed. A path that starts with `/` is
 * relative to the repository root, as on GitHub. The files handed to the guard are the
 * documentation of the repository: its test leaves out `tests/fixtures/`, whose content is
 * wrong on purpose.
 */

export interface MarkdownLinksInput {
  /** The Markdown files of the repository, with their text. */
  docs: readonly TextFile[]
  /** Whether a repository-relative path is a file or a directory of the repository. */
  exists: (path: string) => boolean
  /** The anchors of a Markdown file of the repository, or `undefined` when it has none to give. */
  anchorsOf: (path: string) => readonly string[] | undefined
}

/** The anchors GitHub gives to the headings of a Markdown text, repeated ones numbered. */
export function anchorsOf(markdown: string): string[] {
  const seen = new Map<string, number>()
  const anchors: string[] = []
  for (const { text } of headings(markdown)) {
    const base = text
      .replace(/<[^>]+>/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[`*]/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '')
      .trim()
      .replace(/ /g, '-')
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    anchors.push(count === 0 ? base : `${base}-${count}`)
  }
  return anchors
}

const INLINE_LINK = /!?\[[^\]]*\]\(\s*(<[^>\n]*>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g
const REFERENCE = /^ {0,3}\[[^\]]+\]:\s+(<[^>\n]*>|\S+)/gm

function normalize(path: string): string {
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/')
}

export function checkMarkdownLinks(input: MarkdownLinksInput): Violation[] {
  const violations: Violation[] = []
  for (const doc of input.docs) {
    const text = stripFencedBlocks(doc.text).replace(/(`+)[^`]*?\1/g, (code) =>
      ' '.repeat(code.length),
    )
    const links: { target: string; offset: number }[] = []
    for (const match of text.matchAll(INLINE_LINK)) {
      links.push({ target: match[1] ?? '', offset: match.index })
    }
    for (const match of text.matchAll(REFERENCE)) {
      links.push({ target: match[1] ?? '', offset: match.index })
    }

    for (const link of links) {
      const target = link.target.replace(/^<|>$/g, '')
      if (target === '' || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue
      const line = text.slice(0, link.offset).split('\n').length
      const hash = target.indexOf('#')
      const pathPart = hash === -1 ? target : target.slice(0, hash)
      const fragment = hash === -1 ? undefined : target.slice(hash + 1)
      const withoutQuery = pathPart.split('?')[0] ?? ''
      let resolved = doc.path
      if (withoutQuery !== '') {
        const decoded = decodeURIComponent(withoutQuery)
        const directory = doc.path.includes('/') ? doc.path.slice(0, doc.path.lastIndexOf('/')) : ''
        resolved = normalize(decoded.startsWith('/') ? decoded : `${directory}/${decoded}`)
        if (!input.exists(resolved)) {
          violations.push({
            rule: 'markdown-links/missing-file',
            file: doc.path,
            message: `line ${line}: the link to ${target} points at ${resolved}, which does not exist`,
          })
          continue
        }
      }
      if (fragment === undefined || fragment === '') continue
      const anchors = resolved.endsWith('.md') ? input.anchorsOf(resolved) : undefined
      if (anchors !== undefined && !anchors.includes(decodeURIComponent(fragment).toLowerCase())) {
        violations.push({
          rule: 'markdown-links/missing-anchor',
          file: doc.path,
          message: `line ${line}: the link to ${target} points at #${fragment}, which is not a heading of ${resolved}`,
        })
      }
    }
  }
  return violations
}
