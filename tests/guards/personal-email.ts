import type { TextFile, Violation } from './types.ts'

/**
 * Guard `personal-email`: the maintainer's personal email address is nowhere in the
 * repository. Git history is public, so the repository uses the GitHub no-reply address, and
 * nothing in the files may leak the real one: no address at `gmail.com` and no address whose
 * local part is the maintainer's GitHub handle, except the no-reply form that GitHub issues
 * (`<id>+<handle>@users.noreply.github.com`).
 *
 * The patterns are assembled from pieces so that this file, which has to name them, does not
 * contain what it forbids. The scan reads every text file, comments and lockfile included.
 */

export interface PersonalEmailInput {
  /** Every text file of the repository. */
  files: readonly TextFile[]
}

const AT = '@'

const PATTERNS: readonly { rule: string; pattern: RegExp; what: string }[] = [
  {
    rule: 'handle',
    pattern: new RegExp(`sergioazoc${AT}(?!users\\.noreply\\.github\\.com)[\\w-]+(?:\\.[\\w-]+)+`),
    what: "an address at the maintainer's handle",
  },
  {
    rule: 'gmail',
    pattern: new RegExp(`[\\w.+-]*${AT}gmail\\.com`, 'i'),
    what: 'a gmail.com address',
  },
]

export function checkPersonalEmail(input: PersonalEmailInput): Violation[] {
  const violations: Violation[] = []
  for (const file of input.files) {
    for (const [index, line] of file.text.split('\n').entries()) {
      for (const { rule, pattern, what } of PATTERNS) {
        if (pattern.test(line)) {
          violations.push({
            rule: `personal-email/${rule}`,
            file: file.path,
            message: `line ${index + 1} holds ${what}: use the GitHub no-reply address or a project address`,
          })
        }
      }
    }
  }
  return violations
}
