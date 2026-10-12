import type { Violation } from './types.ts'

/**
 * Guard `licenses`: the MIT license is the same everywhere. The root `LICENSE` is the MIT
 * text, and the `LICENSE` of every package is a byte-for-byte copy of it, because npm packs
 * the file that sits in the package directory and nothing else.
 */

export interface LicensesInput {
  /** The root `LICENSE`, or `undefined` when it does not exist. */
  root: Uint8Array | undefined
  /** The `LICENSE` of each package directory (`packages/core`), or `undefined` when missing. */
  packages: readonly { dir: string; license: Uint8Array | undefined }[]
}

export function checkLicenses(input: LicensesInput): Violation[] {
  const violations: Violation[] = []
  if (input.root === undefined) {
    violations.push({
      rule: 'license/root-missing',
      file: 'LICENSE',
      message: 'the root LICENSE is missing',
    })
    return violations
  }
  const rootText = Buffer.from(input.root).toString('utf8')
  if (!rootText.startsWith('MIT License\n')) {
    violations.push({
      rule: 'license/root-not-mit',
      file: 'LICENSE',
      message: 'the root LICENSE must be the MIT License: its first line is "MIT License"',
    })
  }
  for (const { dir, license } of input.packages) {
    const file = `${dir}/LICENSE`
    if (license === undefined) {
      violations.push({
        rule: 'license/missing',
        file,
        message: 'the package has no LICENSE: copy the root LICENSE here',
      })
    } else if (Buffer.compare(Buffer.from(license), Buffer.from(input.root)) !== 0) {
      violations.push({
        rule: 'license/differs',
        file,
        message:
          'the LICENSE is not a byte-for-byte copy of the root LICENSE: run `cp LICENSE ' +
          dir +
          '/LICENSE`',
      })
    }
  }
  return violations
}
