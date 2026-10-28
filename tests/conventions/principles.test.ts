import { describe, expect, it } from 'vite-plus/test'
import { OPERATIONS } from '../../packages/core/src/operations/index.ts'
import { checkPrinciples, NO_PRINCIPLE_OPTION, principlesOf } from '../guards/principles.ts'
import { describeViolations } from '../guards/types.ts'
import { file, json } from '../support/fixtures.ts'
import { readText } from '../support/repo.ts'

const readmeWith = (...names: string[]) =>
  file(
    'README.md',
    [
      '# Project',
      '',
      '**Bold text outside the list.**',
      '',
      '## Principles',
      '',
      'Intro with **bold** words.',
      '',
      ...names.map((name, index) => `${index + 1}. **${name}.** Explanation of ${name}.`),
      '',
      '## Other',
      '',
      '1. **Not a principle.** Elsewhere.',
    ].join('\n'),
  )

const formWith = (options: unknown) =>
  file(
    '.github/ISSUE_TEMPLATE/feature_request.yml',
    json({ body: [{ type: 'dropdown', id: 'principle', attributes: { label: 'P', options } }] }),
  )

const NAMES = [
  'Alpha, always',
  'Beta first',
  'Gamma at write time',
  'Delta is the source',
  'Epsilon-native',
]

describe('principles', () => {
  it('the README principles are the options of the feature request dropdown', () => {
    const violations = checkPrinciples({
      readme: file('README.md', readText('README.md')),
      featureRequest: file(
        '.github/ISSUE_TEMPLATE/feature_request.yml',
        readText('.github/ISSUE_TEMPLATE/feature_request.yml'),
      ),
    })
    expect(describeViolations(violations)).toEqual([])
    expect(principlesOf(readText('README.md'))).toEqual([
      'Headless, always',
      'The agent is the primary editor',
      'Contracts at write time',
      'Markdown is the source of truth',
      'Cloudflare-native, close to zero cost',
    ])
  })

  it('leaves who may sign in and what a token may do out of MCP, as principle 2 says', () => {
    const names = OPERATIONS.map(({ name }) => name)

    expect(names).toContain('approve_review')
    expect(
      names.filter((name) => /token|invit|member|role|people|person|passkey|session/.test(name)),
    ).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    const readme = readmeWith(...NAMES)

    it('reads only the numbered bold names of the Principles section, without their period', () => {
      expect(principlesOf(readme.text)).toEqual(NAMES)
    })

    it('accepts matching names followed by the "none" option', () => {
      expect(
        checkPrinciples({ readme, featureRequest: formWith([...NAMES, NO_PRINCIPLE_OPTION]) }),
      ).toEqual([])
    })

    it('reports a principle renamed in the README only', () => {
      const renamed = readmeWith('Alpha, usually', ...NAMES.slice(1))
      expect(
        checkPrinciples({
          readme: renamed,
          featureRequest: formWith([...NAMES, NO_PRINCIPLE_OPTION]),
        }),
      ).toEqual([
        {
          rule: 'principles/mismatch',
          file: '.github/ISSUE_TEMPLATE/feature_request.yml',
          message:
            'the dropdown options ["Alpha, always","Beta first","Gamma at write time","Delta is the source","Epsilon-native"] must equal the principles of the README ["Alpha, usually","Beta first","Gamma at write time","Delta is the source","Epsilon-native"], in the same order',
        },
      ])
    })

    it('reports a dropdown in another order, and one that lost an option', () => {
      const swapped = [NAMES[1], NAMES[0], ...NAMES.slice(2), NO_PRINCIPLE_OPTION]
      expect(
        checkPrinciples({ readme, featureRequest: formWith(swapped) }).map(
          (violation) => violation.rule,
        ),
      ).toEqual(['principles/mismatch'])
      const short = [...NAMES.slice(1), NO_PRINCIPLE_OPTION]
      expect(
        checkPrinciples({ readme, featureRequest: formWith(short) }).map(
          (violation) => violation.rule,
        ),
      ).toEqual(['principles/mismatch'])
    })

    it('reports a dropdown that does not end with the "none" option', () => {
      expect(
        checkPrinciples({ readme, featureRequest: formWith(NAMES) }).map(
          (violation) => violation.rule,
        ),
      ).toEqual(['principles/none-option', 'principles/mismatch'])
    })

    it('reports a README that does not list five principles', () => {
      const four = readmeWith(...NAMES.slice(0, 4))
      const result = checkPrinciples({
        readme: four,
        featureRequest: formWith([...NAMES.slice(0, 4), NO_PRINCIPLE_OPTION]),
      })
      expect(result).toEqual([
        {
          rule: 'principles/count',
          file: 'README.md',
          message:
            'the "## Principles" section must list exactly 5 numbered principles, each starting with its bold name, found 4',
        },
      ])
    })

    it('reports a form without the dropdown', () => {
      const result = checkPrinciples({ readme, featureRequest: file('f.yml', json({ body: [] })) })
      expect(result).toEqual([
        {
          rule: 'principles/dropdown',
          file: 'f.yml',
          message: 'the form needs a dropdown with the id "principle" and a list of options',
        },
      ])
    })
  })
})
