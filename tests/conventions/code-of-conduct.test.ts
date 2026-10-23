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
    it('accepts the contact in a mailto link', () => {
      expect(check('Report to [conduct@hollware.com](mailto:conduct@hollware.com).')).toEqual([])
    })

    it('reports the template placeholder', () => {
      expect(check('Report to [INSERT CONTACT METHOD]. Also conduct@hollware.com.')).toEqual([
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
          message: 'the enforcement contact must be conduct@hollware.com',
        },
      ])
    })

    it('reports another address, alone or next to the right one', () => {
      expect(check('Report to someone@example.com.').map((violation) => violation.message)).toEqual(
        [
          'the enforcement contact must be conduct@hollware.com',
          'someone@example.com is not the enforcement contact conduct@hollware.com: it is the only address the file may hold',
        ],
      )
      expect(
        check('conduct@hollware.com or other@hollware.com').map((violation) => violation.message),
      ).toEqual([
        'other@hollware.com is not the enforcement contact conduct@hollware.com: it is the only address the file may hold',
      ])
    })
  })
})
