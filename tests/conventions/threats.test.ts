import { describe, expect, it } from 'vite-plus/test'
import { checkThreats, type Threat } from '../guards/threats.ts'
import { describeViolations } from '../guards/types.ts'
import { RETIRED_THREATS, THREATS } from '../security/threats.ts'
import { file } from '../support/fixtures.ts'
import { readRepoFiles } from '../support/repo.ts'

describe('the threats of Hollware', () => {
  it('each cite a test of the repository that fails when its mitigation goes, or say why the risk is taken', () => {
    const cited = new Set(
      THREATS.flatMap((threat) =>
        'guards' in threat ? threat.guards.map((guard) => guard.file) : [],
      ),
    )
    const files = readRepoFiles((path) => cited.has(path))

    expect(THREATS.length).toBeGreaterThan(80)
    expect(
      describeViolations(checkThreats({ threats: THREATS, retired: RETIRED_THREATS, files })),
    ).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    const tests = file(
      'tests/forged.test.ts',
      "describe('a token', () => {\n  it.each([1, 2])('refuses a forged token %s', () => {})\n})\nconst note = 'refuses a hashed token'\n",
    )
    const guarded = (id: string, guards: { file: string; test: string }[]): Threat => ({
      id,
      area: 'Tokens',
      threat: 'A forged token',
      mitigation: 'Tokens are compared by their hash',
      guards,
    })
    const check = (threats: Threat[], retired: string[] = []) =>
      checkThreats({ threats, retired, files: [tests] }).map((violation) => violation.message)

    it('takes a threat whose test is there, as it or in an it.each, and one accepted with its reason', () => {
      expect(
        check([
          guarded('T-01', [{ file: 'tests/forged.test.ts', test: 'refuses a forged token %s' }]),
          guarded('T-02', [{ file: 'tests/forged.test.ts', test: 'a token' }]),
          { id: 'T-03', area: 'Tokens', threat: 'A token leaks', accepted: 'It reads public data' },
        ]),
      ).toEqual([])
    })

    it('reports a test that is gone, a title that is no test, a file that is gone, and a threat with none', () => {
      expect(
        check([
          guarded('T-01', [{ file: 'tests/forged.test.ts', test: 'refuses an old token' }]),
          guarded('T-02', [{ file: 'tests/forged.test.ts', test: 'refuses a hashed token' }]),
          guarded('T-03', [{ file: 'tests/gone.test.ts', test: 'refuses a forged token %s' }]),
          guarded('T-04', []),
        ]),
      ).toEqual([
        'T-01 cites "refuses an old token" in tests/forged.test.ts, which has no test of that title',
        'T-02 cites "refuses a hashed token" in tests/forged.test.ts, which has no test of that title',
        'T-03 cites tests/gone.test.ts, which is no file of the repository',
        'T-04 names no test that fails when its mitigation goes',
      ])
    })

    it('reports an id twice, a retired id, an id of another shape, and a risk accepted without a reason', () => {
      const fine = [{ file: 'tests/forged.test.ts', test: 'a token' }]
      expect(
        check(
          [
            guarded('T-01', fine),
            guarded('T-01', fine),
            guarded('T-06', fine),
            guarded('X-1', fine),
            { id: 'T-07', area: 'Tokens', threat: 'A token leaks', accepted: ' ' },
          ],
          ['T-06'],
        ),
      ).toEqual([
        'T-01 names two threats',
        'T-06 is retired: a new threat takes a new id',
        'X-1 is no id of a threat: T- and two or three digits',
        'T-07 is accepted without saying why',
      ])
    })
  })
})
