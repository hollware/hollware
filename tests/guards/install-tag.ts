import type { TextFile, Violation } from './types.ts'

export interface InstallTagInput {
  tag: string | null
  files: readonly TextFile[]
}

const INSTALL = /\b(?:npm|pnpm|yarn|bun) create hollware(?:@([\w.-]+))?( +[^\s`'"[\]]+)?/g

export function checkInstallTag(input: InstallTagInput): Violation[] {
  const violations: Violation[] = []
  const wanted = input.tag === null ? 'create hollware' : `create hollware@${input.tag}`
  for (const file of input.files) {
    for (const [index, line] of file.text.split('\n').entries()) {
      for (const [command, tag, argument] of line.matchAll(INSTALL)) {
        const shown = `\`${command.trim()}\``
        if (tag !== undefined && tag !== input.tag) {
          violations.push({
            rule: 'install-tag/wrong',
            file: file.path,
            message:
              input.tag === null
                ? `line ${index + 1} installs with ${shown}, a tag of the prereleases: write \`${wanted}\` now that the release left pre mode`
                : `line ${index + 1} installs with ${shown}: the prereleases are tagged \`${input.tag}\`, so write \`${wanted}\``,
          })
        } else if (tag === undefined && argument !== undefined && input.tag !== null) {
          violations.push({
            rule: 'install-tag/missing',
            file: file.path,
            message: `line ${index + 1} installs with ${shown}, which gets the last stable release: write \`${wanted}\` while the release is in pre mode`,
          })
        }
      }
    }
  }
  return violations
}
