import { stringify } from 'yaml'
import { describe, expect, it } from 'vite-plus/test'
import {
  checkConformanceBaselines,
  CONFORMANCE_REVISIONS,
  parseBaseline,
  parseProfile,
  profileCovers,
  splitCheck,
  type ProfileEntry,
} from '../guards/conformance-baselines.ts'
import { describeViolations } from '../guards/types.ts'
import { file } from '../support/fixtures.ts'
import { readText } from '../support/repo.ts'

// Fails when: a baseline of the MCP conformance suite has an entry without a class (not-offered,
// fixture or upstream) or without a reason, or with a class outside the three, or an upstream entry
// without a link to its issue, or an entry for a whole scenario, or a duplicate; an entry matches a
// check of the must-pass profile; a baseline holds more entries than its recordedSize, or fewer
// without the size following; a revision has no baseline, or a baseline names another revision; the
// profile is malformed, or a revision loses its last check of a claim.

/** The claims that each revision keeps in the must-pass profile (ADR-022). */
const REQUIRED_CLAIMS = {
  '2026-07-28': [
    'lifecycle',
    'tools',
    'tool-errors',
    'json-schema',
    'caching',
    'transport',
    'dns-rebinding',
    'authorization',
    'wire-schema',
  ],
  '2025-11-25': [
    'lifecycle',
    'tools',
    'json-schema',
    'dns-rebinding',
    'authorization',
    'wire-schema',
  ],
}

const REVISIONS = [...CONFORMANCE_REVISIONS]

const BASELINE_PATH = (revision: string) => `tests/conformance/baselines/${revision}.yaml`
const PROFILE_PATH = 'tests/conformance/must-pass.yaml'

describe('conformance baselines', () => {
  it('the baselines only shrink and excuse nothing that Hollware claims, and the profile keeps its claims', () => {
    const baselines = REVISIONS.map((revision) =>
      file(BASELINE_PATH(revision), readText(BASELINE_PATH(revision))),
    )
    const profile = file(PROFILE_PATH, readText(PROFILE_PATH))
    expect(
      describeViolations(
        checkConformanceBaselines({
          baselines,
          profile,
          revisions: REVISIONS,
          requiredClaims: REQUIRED_CLAIMS,
        }),
      ),
    ).toEqual([])

    // The guard must have read real data: these are the revisions the suite is run for, a
    // baseline of the size it records, and the claims of the profile.
    expect(REVISIONS).toEqual(['2026-07-28', '2025-11-25'])
    for (const baselineFile of baselines) {
      const { baseline } = parseBaseline(baselineFile)
      expect(baseline?.entries.length).toBe(baseline?.recordedSize)
      expect(baseline?.entries.length).toBeGreaterThan(20)
    }
    expect([...new Set(parseProfile(profile).entries.map((entry) => entry.claim))]).toEqual([
      'lifecycle',
      'tools',
      'tool-errors',
      'json-schema',
      'caching',
      'transport',
      'dns-rebinding',
      'wire-schema',
      'authorization',
    ])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    interface Item {
      check?: string
      class?: unknown
      reason?: unknown
      [key: string]: unknown
    }
    const REASON = 'The suite expects a fixture tool that Hollware does not have.'
    const entry = (check: string, kind: unknown = 'fixture', reason: unknown = REASON): Item => ({
      check,
      class: kind,
      reason,
    })

    const baseline = (revision: string, entries: Item[], recordedSize = entries.length) =>
      file(BASELINE_PATH(revision), stringify({ revision, recordedSize, entries }))

    const PROFILE: ProfileEntry[] = [
      {
        claim: 'lifecycle',
        revisions: ['2026-07-28'],
        scenario: 'server-stateless',
        checks: ['sep-2575-server-implements-discover'],
      },
      {
        claim: 'tools',
        revisions: ['2026-07-28', '2025-11-25'],
        scenario: 'tools-list',
        checks: undefined,
      },
      {
        claim: 'wire-schema',
        revisions: ['2026-07-28', '2025-11-25'],
        scenario: '*',
        checks: ['wire-schema-valid'],
      },
    ]
    const profileFile = (entries: unknown[] = PROFILE) => file(PROFILE_PATH, stringify({ entries }))

    const REQUIRED = {
      '2026-07-28': ['lifecycle', 'tools', 'wire-schema'],
      '2025-11-25': ['tools', 'wire-schema'],
    }
    const GOOD_2026 = baseline('2026-07-28', [
      entry('tools-call-error:tools-call-error'),
      entry(
        'prompts-list:prompts-list',
        'not-offered',
        'Hollware offers no prompts, so prompts/list is not a method.',
      ),
    ])
    const GOOD_2025 = baseline('2025-11-25', [entry('tools-call-error:tools-call-error')])

    const check = (
      overrides: {
        baselines?: ReturnType<typeof file>[]
        profile?: ReturnType<typeof file>
        required?: Record<string, string[]>
      } = {},
    ) =>
      checkConformanceBaselines({
        baselines: overrides.baselines ?? [GOOD_2026, GOOD_2025],
        profile: overrides.profile ?? profileFile(),
        revisions: REVISIONS,
        requiredClaims: overrides.required ?? REQUIRED,
      })

    const violation = (rule: string, path: string, message: string) => ({
      rule: `conformance-baselines/${rule}`,
      file: path,
      message,
    })

    it('accepts baselines with a class, a reason and a size that fit, and a profile that holds its claims', () => {
      expect(check()).toEqual([])
    })

    it('reports an entry without a class', () => {
      const bad = baseline('2026-07-28', [{ check: 'caching:a', reason: REASON }])
      expect(check({ baselines: [bad, GOOD_2025] })).toEqual([
        violation(
          'no-class',
          BASELINE_PATH('2026-07-28'),
          'entry "caching:a" has no class: say why it fails, with one of not-offered, fixture, upstream',
        ),
      ])
    })

    it('reports a class outside the three', () => {
      const bad = baseline('2026-07-28', [entry('caching:a', 'flaky')])
      expect(check({ baselines: [bad, GOOD_2025] })).toEqual([
        violation(
          'unknown-class',
          BASELINE_PATH('2026-07-28'),
          'entry "caching:a" has the class "flaky": use one of not-offered, fixture, upstream',
        ),
      ])
    })

    it('reports an entry without a reason, or with one too short to say anything', () => {
      const none = baseline('2026-07-28', [{ check: 'caching:a', class: 'fixture' }])
      const short = baseline('2026-07-28', [entry('caching:a', 'fixture', 'broken')])
      for (const bad of [none, short]) {
        expect(check({ baselines: [bad, GOOD_2025] })).toEqual([
          violation(
            'no-reason',
            BASELINE_PATH('2026-07-28'),
            'entry "caching:a" needs a reason of at least 20 characters: say what makes the check fail and why that is expected',
          ),
        ])
      }
    })

    it('asks an upstream entry for the link of its issue in the repository of the suite', () => {
      const without = baseline('2026-07-28', [
        entry('caching:a', 'upstream', 'The suite counts a skipped check as a failure here.'),
      ])
      expect(check({ baselines: [without, GOOD_2025] })).toEqual([
        violation(
          'no-issue-link',
          BASELINE_PATH('2026-07-28'),
          'entry "caching:a" is a defect of the suite, so its reason must link its issue in https://github.com/modelcontextprotocol/conformance/issues',
        ),
      ])
      const linked = baseline('2026-07-28', [
        entry(
          'caching:a',
          'upstream',
          'The suite counts a skipped check as a failure: https://github.com/modelcontextprotocol/conformance/issues/123',
        ),
      ])
      expect(check({ baselines: [linked, GOOD_2025] })).toEqual([])
    })

    it('reports an entry that names a whole scenario, which would excuse every check in it', () => {
      for (const name of ['caching', 'caching:', ':a']) {
        const bad = baseline('2026-07-28', [entry(name)])
        expect(
          check({ baselines: [bad, GOOD_2025] }).filter((found) =>
            found.rule.endsWith('/whole-scenario'),
          ),
        ).toEqual([
          violation(
            'whole-scenario',
            BASELINE_PATH('2026-07-28'),
            `entry "${name}" does not name one check: write "<scenario>:<check id>", because an entry for a whole scenario excuses every check in it`,
          ),
        ])
      }
    })

    it('reports a check listed twice', () => {
      const bad = baseline('2026-07-28', [entry('caching:a'), entry('caching:a')])
      expect(check({ baselines: [bad, GOOD_2025] })).toEqual([
        violation('duplicate', BASELINE_PATH('2026-07-28'), 'entry "caching:a" is listed twice'),
      ])
    })

    it('reports an entry that excuses a check of the must-pass profile, by name, by scenario or by wildcard', () => {
      const named = baseline('2026-07-28', [
        entry('server-stateless:sep-2575-server-implements-discover'),
      ])
      const whole = baseline('2026-07-28', [entry('tools-list:tools-name-format')])
      const wildcard = baseline('2026-07-28', [entry('prompts-list:wire-schema-valid')])
      expect(check({ baselines: [named, GOOD_2025] })).toEqual([
        violation(
          'in-must-pass',
          BASELINE_PATH('2026-07-28'),
          'entry "server-stateless:sep-2575-server-implements-discover" excuses a check of the must-pass profile (claim "lifecycle"): a regression in what Hollware claims must fail the run, so fix Hollware instead of baselining it',
        ),
      ])
      expect(check({ baselines: [whole, GOOD_2025] })).toEqual([
        violation(
          'in-must-pass',
          BASELINE_PATH('2026-07-28'),
          'entry "tools-list:tools-name-format" excuses a check of the must-pass profile (claim "tools"): a regression in what Hollware claims must fail the run, so fix Hollware instead of baselining it',
        ),
      ])
      expect(check({ baselines: [wildcard, GOOD_2025] })).toEqual([
        violation(
          'in-must-pass',
          BASELINE_PATH('2026-07-28'),
          'entry "prompts-list:wire-schema-valid" excuses a check of the must-pass profile (claim "wire-schema"): a regression in what Hollware claims must fail the run, so fix Hollware instead of baselining it',
        ),
      ])
    })

    it('judges an entry against the profile of its own revision only', () => {
      // server-stateless is in the profile for 2026-07-28 only.
      const other = baseline('2025-11-25', [
        entry('server-stateless:sep-2575-server-implements-discover'),
      ])
      expect(check({ baselines: [GOOD_2026, other] })).toEqual([])
    })

    it('reports a baseline that holds more entries than its recorded size', () => {
      const bad = baseline('2026-07-28', [entry('caching:a'), entry('caching:b')], 1)
      expect(check({ baselines: [bad, GOOD_2025] })).toEqual([
        violation(
          'over-size',
          BASELINE_PATH('2026-07-28'),
          'the baseline holds 2 entries but recordedSize is 1: a baseline only shrinks, so fix the cause instead of adding an entry',
        ),
      ])
    })

    it('reports a baseline that shrank without its recorded size following', () => {
      const bad = baseline('2026-07-28', [entry('caching:a')], 3)
      expect(check({ baselines: [bad, GOOD_2025] })).toEqual([
        violation(
          'slack',
          BASELINE_PATH('2026-07-28'),
          'the baseline holds 1 entries but recordedSize is 3: lower recordedSize to 1, or it leaves room to add an entry unnoticed',
        ),
      ])
    })

    it('reports a missing size, and a size that is not a whole number', () => {
      for (const recordedSize of [undefined, -1, 1.5, 'two']) {
        const bad = file(
          BASELINE_PATH('2026-07-28'),
          stringify({ revision: '2026-07-28', recordedSize, entries: [] }),
        )
        expect(check({ baselines: [bad, GOOD_2025] }).map((found) => found.rule)).toEqual([
          'conformance-baselines/invalid-file',
        ])
      }
    })

    it('reports a revision without a baseline, a baseline of another revision and a wrong revision key', () => {
      expect(check({ baselines: [GOOD_2026] })).toEqual([
        violation(
          'missing-baseline',
          BASELINE_PATH('2025-11-25'),
          'there is no baseline for 2025-11-25: every revision has one file, which may hold no entries',
        ),
      ])
      const stray = baseline('2024-11-05', [])
      expect(check({ baselines: [GOOD_2026, GOOD_2025, stray] })).toEqual([
        violation(
          'unknown-revision',
          BASELINE_PATH('2024-11-05'),
          'the file is not the baseline of a revision Hollware serves: name it tests/conformance/baselines/<revision>.yaml, with one of 2026-07-28, 2025-11-25',
        ),
      ])
      const copied = file(
        BASELINE_PATH('2025-11-25'),
        stringify({ revision: '2026-07-28', recordedSize: 0, entries: [] }),
      )
      expect(check({ baselines: [GOOD_2026, copied] })).toEqual([
        violation(
          'revision',
          BASELINE_PATH('2025-11-25'),
          'the file is named for 2025-11-25 but says "revision: 2026-07-28"',
        ),
      ])
    })

    it('reports a baseline that is not YAML, has a key nothing reads, or an entry that is not a mapping', () => {
      const broken = file(BASELINE_PATH('2026-07-28'), 'revision: [unclosed')
      expect(check({ baselines: [broken, GOOD_2025] }).map((found) => found.rule)).toEqual([
        'conformance-baselines/invalid-file',
      ])
      const extra = file(
        BASELINE_PATH('2026-07-28'),
        stringify({
          revision: '2026-07-28',
          recordedSize: 1,
          entries: [{ ...entry('caching:a'), clas: 'x' }],
        }),
      )
      expect(check({ baselines: [extra, GOOD_2025] })).toEqual([
        violation(
          'entry-shape',
          BASELINE_PATH('2026-07-28'),
          'entry 1 has the key "clas", which nothing reads: the keys are check, class, reason',
        ),
      ])
      const scalar = file(
        BASELINE_PATH('2026-07-28'),
        stringify({ revision: '2026-07-28', recordedSize: 1, entries: ['caching:a'] }),
      )
      expect(check({ baselines: [scalar, GOOD_2025] }).map((found) => found.rule)).toEqual([
        'conformance-baselines/entry-shape',
        'conformance-baselines/slack',
      ])
    })

    it('reports a revision that has lost its last check of a claim', () => {
      const lessWire = PROFILE.filter((item) => item.claim !== 'wire-schema')
      expect(check({ profile: profileFile(lessWire) })).toEqual([
        violation(
          'missing-claim',
          PROFILE_PATH,
          'the must-pass profile has no check of the claim "wire-schema" for 2026-07-28: deleting the last one would leave that claim unguarded',
        ),
        violation(
          'missing-claim',
          PROFILE_PATH,
          'the must-pass profile has no check of the claim "wire-schema" for 2025-11-25: deleting the last one would leave that claim unguarded',
        ),
      ])
      const lifecycleOnlyIn2026 = { ...REQUIRED, '2025-11-25': ['lifecycle'] }
      expect(check({ required: lifecycleOnlyIn2026 })).toEqual([
        violation(
          'missing-claim',
          PROFILE_PATH,
          'the must-pass profile has no check of the claim "lifecycle" for 2025-11-25: deleting the last one would leave that claim unguarded',
        ),
      ])
    })

    it('reports a profile entry that cannot be read', () => {
      const bad: unknown[] = [
        { revisions: ['2026-07-28'], scenario: 'tools-list' },
        { claim: 'tools', revisions: ['2024-11-05'], scenario: 'tools-list' },
        { claim: 'tools', revisions: ['2026-07-28'] },
        { claim: 'wire', revisions: ['2026-07-28'], scenario: '*' },
        { claim: 'tools', revisions: ['2026-07-28'], scenario: 'tools-list', checks: [] },
        { claim: 'tools', revisions: ['2026-07-28'], scenario: 'tools-list', checks: ['a', 'a'] },
        {
          claim: 'tools',
          revisions: ['2026-07-28'],
          scenario: 'tools-list',
          checks: ['a'],
          note: 'x',
        },
      ]
      const found = parseProfile(profileFile(bad)).violations.map((item) => item.message)
      expect(found).toEqual([
        'profile entry 1 has no "claim": name what Hollware claims',
        'profile entry 2 lists the revision "2024-11-05": use 2026-07-28 or 2025-11-25',
        'profile entry 3 has no "scenario"',
        'profile entry 4 covers *, so it must name the "checks" that every scenario passes',
        'profile entry 5 has "checks" that is not a list of check ids: leave it out to require every check of the scenario',
        'profile entry 6 lists the check "a" twice',
        'profile entry 7 has the key "note", which nothing reads: the keys are claim, revisions, scenario, checks',
      ])
    })

    it('reports a profile that is not a mapping with a list of entries', () => {
      expect(parseProfile(file(PROFILE_PATH, '- one\n- two\n')).violations).toEqual([
        violation('invalid-profile', PROFILE_PATH, 'the file must hold a mapping at its top level'),
      ])
      expect(parseProfile(file(PROFILE_PATH, 'entries: none\n')).violations).toEqual([
        violation('invalid-profile', PROFILE_PATH, '"entries" must be a list'),
      ])
    })

    it('hands the runner a baseline only when it breaks no rule', () => {
      const good = parseBaseline(GOOD_2026)
      expect(good.violations).toEqual([])
      expect(good.baseline).toEqual({
        revision: '2026-07-28',
        recordedSize: 2,
        entries: [
          { check: 'tools-call-error:tools-call-error', class: 'fixture', reason: REASON },
          {
            check: 'prompts-list:prompts-list',
            class: 'not-offered',
            reason: 'Hollware offers no prompts, so prompts/list is not a method.',
          },
        ],
      })
      const bad = parseBaseline(baseline('2026-07-28', [entry('caching:a', 'flaky')]))
      expect(bad.baseline).toBeUndefined()
      expect(bad.violations).toHaveLength(1)
    })

    it('splits a check at the first colon and matches the profile of a revision', () => {
      expect(splitCheck('server-stateless:a:b')).toEqual({
        scenario: 'server-stateless',
        id: 'a:b',
      })
      expect(splitCheck('caching')).toEqual({ scenario: 'caching', id: undefined })
      const [lifecycle, tools, wire] = PROFILE
      if (lifecycle === undefined || tools === undefined || wire === undefined) {
        throw new Error('the fixture profile lost an entry')
      }
      expect(
        profileCovers(
          lifecycle,
          '2026-07-28',
          'server-stateless',
          'sep-2575-server-implements-discover',
        ),
      ).toBe(true)
      expect(profileCovers(lifecycle, '2026-07-28', 'server-stateless', 'another-check')).toBe(
        false,
      )
      expect(
        profileCovers(
          lifecycle,
          '2025-11-25',
          'server-stateless',
          'sep-2575-server-implements-discover',
        ),
      ).toBe(false)
      expect(profileCovers(lifecycle, '2026-07-28', 'server-stateless', undefined)).toBe(true)
      expect(profileCovers(tools, '2025-11-25', 'tools-list', 'anything')).toBe(true)
      expect(profileCovers(wire, '2026-07-28', 'any-scenario', 'wire-schema-valid')).toBe(true)
      expect(profileCovers(wire, '2026-07-28', 'any-scenario', 'other')).toBe(false)
    })
  })
})
