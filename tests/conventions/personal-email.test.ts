import { describe, expect, it } from 'vite-plus/test'
import { checkPersonalEmail } from '../guards/personal-email.ts'
import { describeViolations } from '../guards/types.ts'
import { file } from '../support/fixtures.ts'
import { readRepoFiles, readTextUnlessBinary, repoFiles } from '../support/repo.ts'

// Fails when: any file of the repository holds an email address at gmail.com, or an address
// whose local part is the maintainer's GitHub handle (the GitHub no-reply form is fine).

// The strings below are assembled so that this file does not contain what it forbids.
const AT = '@'
const handle = 'sergioazoc'

const check = (text: string) => checkPersonalEmail({ files: [file('notes.md', text)] })

describe('personal email', () => {
  it('no file of the repository leaks a personal address', () => {
    const files = repoFiles()
      .map((path) => ({ path, text: readTextUnlessBinary(path) }))
      .flatMap(({ path, text }) => (text === undefined ? [] : [file(path, text)]))
    expect(files.length).toBeGreaterThan(100)
    expect(readRepoFiles((path) => path === 'PLAN.md')).toHaveLength(1)
    expect(describeViolations(checkPersonalEmail({ files }))).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    it('accepts the GitHub no-reply address, the bare handle and project addresses', () => {
      expect(check(`6147546+${handle}${AT}users.noreply.github.com`)).toEqual([])
      expect(check(`grep -rIn "${handle}${AT}" .`)).toEqual([])
      expect(check(`@${handle} owns this; mail conduct${AT}hollware.com`)).toEqual([])
    })

    it('reports an address at the maintainer handle', () => {
      expect(check(`first line\nwrite to ${handle}${AT}example.com`)).toEqual([
        {
          rule: 'personal-email/handle',
          file: 'notes.md',
          message:
            "line 2 holds an address at the maintainer's handle: use the GitHub no-reply address or a project address",
        },
      ])
    })

    it('reports any gmail.com address, in any case', () => {
      for (const address of [`someone${AT}gmail.com`, `Someone.Else+tag${AT}GMAIL.COM`]) {
        expect(check(`contact: ${address}`).map((violation) => violation.rule)).toEqual([
          'personal-email/gmail',
        ])
      }
    })

    it('reports an address that is both', () => {
      expect(check(`${handle}${AT}gmail.com`).map((violation) => violation.rule)).toEqual([
        'personal-email/handle',
        'personal-email/gmail',
      ])
    })
  })
})
