import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'

import { judge, p95, recall, type Run } from './eval-search.ts'

// Fails when: the search evaluation (scripts/eval-search.ts) stops counting a hit only within the
// first five, stops keeping the kinds of query apart, takes another percentile than the 95th by
// nearest rank, or judges a mode against other gates than 0.85, 0.70 and 400 ms; or its labelled
// queries stop being at least forty, a third across languages, each expecting a group the corpus
// has in the locale it is asked in.

const run = (kind: Run['kind'], place: number | null, ms = 100): Run => ({ kind, place, ms })

describe('the scores of the search evaluation', () => {
  it('counts a hit within the first five, kind by kind', () => {
    const runs = [
      run('same-language', 0),
      run('same-language', 4),
      run('same-language', 5),
      run('same-language', null),
      run('cross-language', 1),
    ]

    expect([recall(runs, 'same-language'), recall(runs, 'cross-language')]).toEqual([0.5, 1])
    expect([recall(runs, 'same-language', 1), recall(runs, 'cross-language', 1)]).toEqual([0.25, 0])
  })

  it('takes the 95th percentile by nearest rank', () => {
    const times = Array.from({ length: 20 }, (_, index) => index + 1)

    expect(p95(times)).toBe(19)
    expect(p95([300])).toBe(300)
  })

  it('judges a mode against 0.85 within a language, 0.70 across and 400 ms', () => {
    const passing = [
      ...Array.from({ length: 17 }, () => run('same-language', 0)),
      ...Array.from({ length: 3 }, () => run('same-language', null)),
      ...Array.from({ length: 7 }, () => run('cross-language', 2)),
      ...Array.from({ length: 3 }, () => run('cross-language', null)),
    ]
    const slow = passing.map((one) => ({ ...one, ms: 401 }))
    const crossShort = [...passing, run('cross-language', null)]

    expect(judge('hybrid', passing)).toEqual({
      ok: true,
      line: 'hybrid   recall@5 same 0.85  cross 0.70  recall@1 same 0.85  cross 0.00  p95 100 ms',
    })
    expect([judge('hybrid', slow).ok, judge('hybrid', crossShort).ok]).toEqual([false, false])
  })
})

const EVAL = join(import.meta.dirname, '../tests/fixtures/eval')

/** The translation groups that the corpus has in a locale. */
function groupsIn(locale: string): Set<string> {
  return new Set(
    readdirSync(join(EVAL, 'corpus', locale)).map(
      (file) =>
        /^translationGroup: (.*)$/m.exec(
          readFileSync(join(EVAL, 'corpus', locale, file), 'utf8'),
        )?.[1] ?? '',
    ),
  )
}

describe('the labelled queries', () => {
  it('are forty or more, a third across languages, each with its entry in the corpus', () => {
    const parsed: unknown = JSON.parse(readFileSync(join(EVAL, 'queries.json'), 'utf8'))
    const queries: { locale: string; expect: string; kind: string }[] =
      typeof parsed === 'object' &&
      parsed !== null &&
      'queries' in parsed &&
      Array.isArray(parsed.queries)
        ? parsed.queries
        : []
    const has = new Map([
      ['en', groupsIn('en')],
      ['es', groupsIn('es')],
    ])

    expect(queries.length).toBeGreaterThanOrEqual(40)
    expect(queries.filter((query) => query.kind === 'cross-language').length).toBe(
      queries.length / 3,
    )
    expect(queries.filter((query) => !(has.get(query.locale)?.has(query.expect) ?? false))).toEqual(
      [],
    )
  })
})
