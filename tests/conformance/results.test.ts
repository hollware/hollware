import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import type { Baseline, ProfileEntry } from '../guards/conformance-baselines.ts'
import {
  evaluateBaseline,
  evaluateProfile,
  readScenarioResults,
  readScoredScenarios,
  summarize,
  verdicts,
  type CheckResult,
  type ScenarioResult,
  type Status,
} from './results.ts'

const check = (id: string, status: Status, errorMessage?: string): CheckResult => ({
  id,
  status,
  errorMessage,
})

const scenario = (name: string, ...checks: CheckResult[]): ScenarioResult => ({
  scenario: name,
  checks,
})

const entry = (claim: string, scenarioName: string, checks?: readonly string[]): ProfileEntry => ({
  claim,
  revisions: ['2026-07-28'],
  scenario: scenarioName,
  checks,
})

const baseline = (...checks: [string, 'fixture' | 'not-offered'][]): Baseline => ({
  revision: '2026-07-28',
  recordedSize: checks.length,
  entries: checks.map(([name, kind]) => ({ check: name, class: kind, reason: 'a reason' })),
})

describe('verdicts', () => {
  it('collapses the checks that share an id to the most severe, and leaves INFO out', () => {
    const found = verdicts([
      check('a', 'SUCCESS'),
      check('a', 'WARNING'),
      check('a', 'SUCCESS'),
      check('b', 'SUCCESS'),
      check('b', 'FAILURE', 'first'),
      check('b', 'WARNING'),
      check('c', 'INFO'),
      check('d', 'SKIPPED'),
      check('d', 'SUCCESS'),
    ])
    expect([...found].map(([id, result]) => [id, result.status])).toEqual([
      ['a', 'WARNING'],
      ['b', 'FAILURE'],
      ['d', 'SUCCESS'],
    ])
  })

  it('lets the later occurrence decide when two are equally severe, as the suite does', () => {
    const found = verdicts([check('a', 'FAILURE', 'first'), check('a', 'FAILURE', 'second')])
    expect(found.get('a')?.errorMessage).toBe('second')
  })
})

describe('evaluateProfile', () => {
  const problemsOf = (entries: readonly ProfileEntry[], results: readonly ScenarioResult[]) =>
    evaluateProfile(entries, results).problems
  const passing = [
    scenario('tools-list', check('tools-list', 'SUCCESS'), check('wire-schema-valid', 'SUCCESS')),
    scenario('caching', check('tools-hints', 'SUCCESS'), check('wire-schema-valid', 'SUCCESS')),
  ]

  it('finds nothing when every named check passes', () => {
    expect(
      evaluateProfile(
        [entry('tools', 'tools-list'), entry('caching', 'caching', ['tools-hints'])],
        passing,
      ),
    ).toEqual({ problems: [], passed: 3 })
  })

  it('names a check that fails, with its scenario, its claim and what the suite said', () => {
    const results = [
      scenario(
        'caching',
        check('tools-hints', 'FAILURE', 'ttlMs\nis   missing'),
        check('x', 'SUCCESS'),
      ),
    ]
    expect(problemsOf([entry('caching', 'caching', ['tools-hints'])], results)).toEqual([
      'caching:tools-hints is FAILURE, in the must-pass profile (claim "caching"): ttlMs is missing',
    ])
  })

  it('shortens what the suite said to 160 characters', () => {
    const results = [scenario('caching', check('tools-hints', 'FAILURE', 'a'.repeat(300)))]
    expect(problemsOf([entry('caching', 'caching', ['tools-hints'])], results)).toEqual([
      `caching:tools-hints is FAILURE, in the must-pass profile (claim "caching"): ${'a'.repeat(160)}`,
    ])
  })

  it('fails a warning and a skipped check too: must pass means passed', () => {
    const results = [scenario('dns', check('accepted', 'WARNING'), check('rejected', 'SKIPPED'))]
    expect(problemsOf([entry('dns-rebinding', 'dns')], results)).toEqual([
      'dns:accepted is WARNING, in the must-pass profile (claim "dns-rebinding")',
      'dns:rejected is SKIPPED, in the must-pass profile (claim "dns-rebinding")',
    ])
  })

  it('fails a named check that the suite no longer reports, which the suite itself tolerates', () => {
    expect(problemsOf([entry('caching', 'caching', ['renamed'])], passing)).toEqual([
      'caching:renamed was not reported, and the must-pass profile requires it (claim "caching")',
    ])
  })

  it('fails a scenario that did not run, and one that reported no check', () => {
    expect(problemsOf([entry('transport', 'http-header-validation')], passing)).toEqual([
      'the scenario http-header-validation did not run, and the must-pass profile requires it (claim "transport")',
    ])
    expect(problemsOf([entry('tools', 'empty')], [scenario('empty', check('i', 'INFO'))])).toEqual([
      'the scenario empty reported no check, and the must-pass profile requires it (claim "tools")',
    ])
  })

  it('holds a whole scenario to every check it reports, INFO apart', () => {
    const results = [
      scenario('tools-list', check('a', 'SUCCESS'), check('b', 'INFO'), check('c', 'FAILURE')),
    ]
    expect(problemsOf([entry('tools', 'tools-list')], results)).toEqual([
      'tools-list:c is FAILURE, in the must-pass profile (claim "tools")',
    ])
  })

  it('lets one failing occurrence of a repeated id fail the check', () => {
    const results = [
      scenario(
        'headers',
        check('rejects', 'SUCCESS'),
        check('rejects', 'FAILURE', 'accepted a bad header'),
      ),
    ]
    expect(problemsOf([entry('transport', 'headers', ['rejects'])], results)).toEqual([
      'headers:rejects is FAILURE, in the must-pass profile (claim "transport"): accepted a bad header',
    ])
  })

  it('holds the wildcard to every scenario that reports the id, and to at least one', () => {
    const wire = entry('wire-schema', '*', ['wire-schema-valid'])
    expect(problemsOf([wire], passing)).toEqual([])
    const broken = [
      ...passing,
      scenario('prompts-list', check('wire-schema-valid', 'FAILURE', 'invalid result')),
    ]
    expect(problemsOf([wire], broken)).toEqual([
      'prompts-list:wire-schema-valid is FAILURE, in the must-pass profile (claim "wire-schema"): invalid result',
    ])
    expect(problemsOf([wire], [scenario('ping', check('ping', 'SUCCESS'))])).toEqual([
      'no scenario reported wire-schema-valid, which the must-pass profile requires (claim "wire-schema")',
    ])
  })
})

describe('evaluateBaseline', () => {
  const scored = new Set(['prompts-list', 'tools-call-error', 'caching'])
  const results = [
    scenario('prompts-list', check('prompts-list', 'FAILURE', 'Method not found')),
    scenario(
      'tools-call-error',
      check('tools-call-error', 'WARNING'),
      check('wire-schema-valid', 'SUCCESS'),
    ),
    scenario('caching', check('tools-hints', 'SUCCESS')),
    scenario('tasks-lifecycle', check('tasks-sync-tool-call', 'FAILURE', 'Tool greet not found')),
  ]

  it('finds nothing when the baseline excuses exactly the failing checks of the scored scenarios', () => {
    expect(
      evaluateBaseline(
        baseline(
          ['prompts-list:prompts-list', 'not-offered'],
          ['tools-call-error:tools-call-error', 'fixture'],
        ),
        results,
        scored,
      ),
    ).toEqual({ unexpected: [], excusesNothing: [] })
  })

  it('names a failure outside the baseline in a scored scenario, a warning included', () => {
    expect(
      evaluateBaseline(baseline(['prompts-list:prompts-list', 'not-offered']), results, scored)
        .unexpected,
    ).toEqual(['tools-call-error:tools-call-error is WARNING'])
  })

  it('ignores the failures of a scenario that is not scored', () => {
    const { unexpected } = evaluateBaseline(baseline(), results.slice(2), scored)
    expect(unexpected).toEqual([])
  })

  it('finds each entry that excuses nothing, and says why', () => {
    const entries = baseline(
      ['caching:tools-hints', 'fixture'],
      ['prompts-list:renamed', 'not-offered'],
      ['resources-list:resources-list', 'not-offered'],
      ['tasks-lifecycle:tasks-sync-tool-call', 'fixture'],
      ['prompts-list', 'not-offered'],
    )
    expect(evaluateBaseline(entries, results, scored).excusesNothing).toEqual([
      'caching:tools-hints: the check is SUCCESS, not failing: remove the entry',
      'prompts-list:renamed: the suite does not report this check: remove the entry, or fix its id',
      'resources-list:resources-list: the scenario is not scored for 2026-07-28, so the suite never judges it: remove the entry',
      'tasks-lifecycle:tasks-sync-tool-call: the scenario is not scored for 2026-07-28, so the suite never judges it: remove the entry',
      'prompts-list: the suite does not report this check: remove the entry, or fix its id',
    ])
  })

  it('says when a scored scenario left no result', () => {
    expect(
      evaluateBaseline(
        baseline(['caching:tools-hints', 'fixture']),
        [scenario('prompts-list', check('prompts-list', 'FAILURE'))],
        scored,
      ).excusesNothing,
    ).toEqual(['caching:tools-hints: the scenario did not run: remove the entry, or fix the run'])
  })
})

describe('summarize', () => {
  it('counts the scored and the unscored checks apart, and the entries by class', () => {
    const summary = summarize(
      baseline(
        ['prompts-list:prompts-list', 'not-offered'],
        ['resources-list:resources-list', 'not-offered'],
        ['tools-call-error:tools-call-error', 'fixture'],
      ),
      [
        scenario(
          'prompts-list',
          check('prompts-list', 'FAILURE'),
          check('wire-schema-valid', 'SUCCESS'),
        ),
        scenario(
          'tools-call-error',
          check('tools-call-error', 'WARNING'),
          check('wire-schema-valid', 'SUCCESS'),
        ),
        scenario(
          'tasks-lifecycle',
          check('a', 'FAILURE'),
          check('b', 'FAILURE'),
          check('c', 'SUCCESS'),
          check('d', 'INFO'),
        ),
      ],
      new Set(['prompts-list', 'tools-call-error']),
    )
    expect(summary).toEqual({
      scored: { scenarios: 2, passed: 2, failing: 2 },
      baselined: { 'not-offered': 2, fixture: 1 },
      notScored: { scenarios: 1, passed: 1, failing: 2 },
    })
  })
})

describe('reading the results of a run', () => {
  const directories: string[] = []
  afterEach(() => {
    for (const directory of directories.splice(0))
      rmSync(directory, { recursive: true, force: true })
  })
  const temporary = () => {
    const directory = mkdtempSync(join(tmpdir(), 'hollware-conformance-test-'))
    directories.push(directory)
    return directory
  }
  const save = (directory: string, name: string, content: unknown) => {
    mkdirSync(join(directory, name), { recursive: true })
    writeFileSync(join(directory, name, 'checks.json'), JSON.stringify(content))
  }

  it('reads one scenario per folder of the suite, by the name between the prefix and the timestamp', () => {
    const directory = temporary()
    save(directory, 'server-tools-list-2026-10-13T07-52-46-368Z', [
      { id: 'tools-list', status: 'SUCCESS', errorMessage: null },
      { id: 'tools-name-format', status: 'FAILURE', errorMessage: 'bad name' },
    ])
    save(directory, 'server-input-required-result-multi-round-2026-10-13T07-52-46-516Z', [])
    mkdirSync(join(directory, 'not-a-result'))
    writeFileSync(join(directory, 'output.txt'), 'the suite output')
    expect(readScenarioResults(directory)).toEqual([
      {
        scenario: 'input-required-result-multi-round',
        checks: [],
      },
      {
        scenario: 'tools-list',
        checks: [
          { id: 'tools-list', status: 'SUCCESS', errorMessage: undefined },
          { id: 'tools-name-format', status: 'FAILURE', errorMessage: 'bad name' },
        ],
      },
    ])
  })

  it('refuses a result that is not a list of checks, and a check with an unknown status', () => {
    const directory = temporary()
    save(directory, 'server-ping-2026-10-13T07-52-46-368Z', { id: 'ping' })
    expect(() => readScenarioResults(directory)).toThrow(
      'server-ping-2026-10-13T07-52-46-368Z/checks.json is not a list of checks',
    )
    const other = temporary()
    save(other, 'server-ping-2026-10-13T07-52-46-368Z', [{ id: 'ping', status: 'PASSED' }])
    expect(() => readScenarioResults(other)).toThrow(
      'server-ping-2026-10-13T07-52-46-368Z/checks.json holds something that is not a check',
    )
  })

  it('reads the scored server scenarios of a requirement set, and no client scenario', () => {
    const directory = temporary()
    const file = join(directory, '2026-07-28.yaml')
    writeFileSync(
      file,
      'server:\n  - tools-list\n  - caching\nclient:\n  - tools_call\nnot_scored: []\n',
    )
    expect([...readScoredScenarios(file)]).toEqual(['tools-list', 'caching'])
    writeFileSync(file, 'client:\n  - tools_call\n')
    expect(() => readScoredScenarios(file)).toThrow(`${file} has no list of server scenarios`)
  })
})
