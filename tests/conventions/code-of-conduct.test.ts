import { describe, expect, it } from 'vite-plus/test'
import { checkCodeOfConduct } from '../guards/code-of-conduct.ts'
import { describeViolations } from '../guards/types.ts'
import { file } from '../support/fixtures.ts'
import { readText } from '../support/repo.ts'

const check = (text: string) => checkCodeOfConduct({ conduct: file('CODE_OF_CONDUCT.md', text) })

describe('code of conduct', () => {
  it('has a real enforcement contact and no placeholder left', () => {
    expect(
      describeViolations(
        checkCodeOfConduct({ conduct: file('CODE_OF_CONDUCT.md', readText('CODE_OF_CONDUCT.md')) }),
      ),
    ).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    it('accepts the issues of the repository as the contact', () => {
      expect(check('Report it in <https://github.com/hollware/hollware/issues>.')).toEqual([])
    })

    it('reports the template placeholder', () => {
      expect(
        check('Report to [INSERT CONTACT METHOD] or https://github.com/hollware/hollware/issues.'),
      ).toEqual([
        {
          rule: 'code-of-conduct/placeholder',
          file: 'CODE_OF_CONDUCT.md',
          message:
            'the file still holds a "[INSERT ...]" placeholder of the Contributor Covenant template',
        },
      ])
    })

    it('reports a missing contact', () => {
      expect(check('No way to report.')).toEqual([
        {
          rule: 'code-of-conduct/contact',
          file: 'CODE_OF_CONDUCT.md',
          message:
            'the enforcement contact must be the issues of the repository, https://github.com/hollware/hollware/issues',
        },
      ])
    })

    it('reports an email address, alone or next to the issues', () => {
      expect(
        check('Report to conduct@hollware.com.').map((violation) => violation.message),
      ).toEqual([
        'the enforcement contact must be the issues of the repository, https://github.com/hollware/hollware/issues',
        'conduct@hollware.com is an email address: reports go to https://github.com/hollware/hollware/issues, and the file holds no address',
      ])
      expect(
        check('https://github.com/hollware/hollware/issues or someone@example.com').map(
          (violation) => violation.message,
        ),
      ).toEqual([
        'someone@example.com is an email address: reports go to https://github.com/hollware/hollware/issues, and the file holds no address',
      ])
    })
  })
})
