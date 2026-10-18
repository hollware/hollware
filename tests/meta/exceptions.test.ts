import { describe, expect, it } from 'vite-plus/test'
import { checkExceptionLists, checkNoStrayExceptions } from '../guards/exception-lists.ts'
import { EXCEPTION_LISTS, type ExceptionList } from '../guards/exceptions.ts'
import { describeViolations } from '../guards/types.ts'
import { file } from '../support/fixtures.ts'
import { readRepoFiles } from '../support/repo.ts'

// Fails when: an exception list of tests/guards/exceptions.ts has more entries than its `max`
// (an exception was added) or fewer (one was removed and `max` was not lowered), has a
// duplicate or an entry without a reason; or a guard declares an exception list of its own.

const list = (max: number, ...values: string[]): ExceptionList => ({
  max,
  entries: values.map((value) => ({ value, reason: `Because ${value} cannot be fixed yet.` })),
})

describe('exception lists', () => {
  it('every list is exactly as long as its recorded size, and each entry has a reason', () => {
    expect(Object.keys(EXCEPTION_LISTS).sort()).toEqual([
      'ADMIN_TEXT_LITERALS',
      'INVISIBLE_CHARACTER_FILES',
      'MISSING_DOC_PATHS',
      'OPERATIONS_WITHOUT_ADMIN',
      'OTHER_TEST_RUNNERS',
      'TABLES_WITHOUT_SHARED_COLUMNS',
      'TABLES_WITHOUT_SITE',
      'VIRTUAL_IMPORTS',
      'WEB_TEXT_LITERALS',
      'ZIZMOR_IGNORES',
    ])
    expect(describeViolations(checkExceptionLists(EXCEPTION_LISTS))).toEqual([])
  })

  it('the guards hold no exception list of their own', () => {
    const sources = readRepoFiles(
      (path) =>
        /^tests\/(?:guards|conventions|meta|support)\/[^/]+\.ts$/.test(path) &&
        path !== 'tests/guards/exceptions.ts',
    )
    expect(sources.length).toBeGreaterThan(40)
    expect(describeViolations(checkNoStrayExceptions(sources))).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    it('accepts a list that is exactly its recorded size', () => {
      expect(checkExceptionLists({ A: list(2, 'a', 'b'), B: list(0) })).toEqual([])
    })

    it('reports a list that grew past its recorded size', () => {
      expect(checkExceptionLists({ A: list(1, 'a', 'b') })).toEqual([
        {
          rule: 'exceptions/over-max',
          file: 'tests/guards/exceptions.ts',
          message:
            'A: has 2 entries but max is 1: exception lists only shrink, so fix the cause instead of adding an exception',
        },
      ])
    })

    it('reports a list that shrank without its recorded size following', () => {
      expect(checkExceptionLists({ A: list(3, 'a', 'b') })).toEqual([
        {
          rule: 'exceptions/slack',
          file: 'tests/guards/exceptions.ts',
          message:
            'A: has 2 entries but max is 3: lower max to 2, or it leaves room to add an exception unnoticed',
        },
      ])
    })

    it('reports a duplicate entry once, and an entry without a real reason', () => {
      const lists = {
        A: {
          max: 3,
          entries: [
            { value: 'a', reason: 'A sentence that explains it.' },
            { value: 'a', reason: 'A sentence that explains it.' },
            { value: 'b', reason: 'todo' },
          ],
        },
      }
      expect(checkExceptionLists(lists)).toEqual([
        {
          rule: 'exceptions/duplicate',
          file: 'tests/guards/exceptions.ts',
          message: 'A: "a" is listed twice',
        },
        {
          rule: 'exceptions/no-reason',
          file: 'tests/guards/exceptions.ts',
          message: 'A: "b" needs a reason of at least a sentence',
        },
      ])
    })

    describe('stray exception lists', () => {
      const stray = (text: string) =>
        checkNoStrayExceptions([file('tests/guards/new-guard.ts', text)])

      it('reports an allowlist constant written next to a guard', () => {
        const text = [
          "export const ALLOWED_PATHS = ['a', 'b']",
          "const KNOWN_EXCEPTIONS = new Set(['x'])",
          "const ZIZMOR_IGNORES = { 'a.yml': true }",
          "const skip_list = ['y']",
        ].join('\n')
        expect(stray(text).map((violation) => violation.message.split(' ')[0])).toEqual([
          'ALLOWED_PATHS',
          'KNOWN_EXCEPTIONS',
          'ZIZMOR_IGNORES',
          'skip_list',
        ])
        expect(stray(text)[0]).toEqual({
          rule: 'exceptions/stray-list',
          file: 'tests/guards/new-guard.ts',
          message:
            'ALLOWED_PATHS looks like an exception list outside tests/guards/exceptions.ts: move it there with a max and a reason, and pass it to the guard as an argument',
        })
      })

      it('leaves alone constants that hold no list, and lists with other names', () => {
        const text = [
          "const ALLOWED = 'a single fixture string'",
          "const names = ['a', 'b']",
          "const FORBIDDEN = [{ rule: 'x' }]",
          'export function check(allowed: string[]) { return allowed }',
          "function inner() { const IGNORES = ['not top level'] ; return IGNORES }",
        ].join('\n')
        expect(stray(text)).toEqual([])
      })
    })
  })
})
