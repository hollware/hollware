import type { Violation } from './types.ts'

export interface LicensesInput {
  root: Uint8Array | undefined
  packages: readonly { dir: string; license: Uint8Array | undefined }[]
  copyright: string
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
  if (rootText.split('\n')[2] !== input.copyright) {
    violations.push({
      rule: 'license/copyright',
      file: 'LICENSE',
      message: `the third line of the root LICENSE must be "${input.copyright}"`,
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
