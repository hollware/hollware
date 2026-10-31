import { describe, expect, it } from 'vite-plus/test'
import { CHECK, HOOK as DELEGATE } from '../../scripts/pre-push.ts'
import rootConfig from '../../vite.config.ts'
import { checkPrePush } from '../guards/pre-push.ts'
import { describeViolations } from '../guards/types.ts'
import { readBytesIfExists, readText } from '../support/repo.ts'
import { taskGraph } from '../support/vp.ts'

const CI =
  'jobs:\n  a:\n    steps:\n      - run: vp run check:push\n      - run: vp run e2e:upgrade\n'
const GRAPH = { 'check:local': ['check:push'], 'check:push': [] }
const HOOK = 'vp run check:local\n'

describe('pre-push', () => {
  it('the hook runs what CI runs', () => {
    const hook = readBytesIfExists('.vite-hooks/pre-push')?.toString('utf8')
    expect(
      describeViolations(
        checkPrePush({
          hook,
          delegate: { hook: DELEGATE, command: CHECK },
          graph: taskGraph(rootConfig),
          ci: readText('.github/workflows/ci.yml'),
        }),
      ),
    ).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    it('accepts a hook and a task that cover CI', () => {
      expect(checkPrePush({ hook: HOOK, graph: GRAPH, ci: CI })).toEqual([])
    })

    it('reports a hook that does not run check:local', () => {
      expect(checkPrePush({ hook: 'vp run check:push\n', graph: GRAPH, ci: CI })).toEqual([
        {
          rule: 'pre-push/hook',
          file: '.vite-hooks/pre-push',
          message: 'the hook must run "vp run check:local"',
        },
      ])
    })

    it('accepts a hook that runs a script which runs check:local, and no script that runs less', () => {
      const hook = 'exec node scripts/pre-push.ts\n'
      const delegate = (command: readonly string[]) => ({
        hook: 'node scripts/pre-push.ts',
        command,
      })
      expect(
        checkPrePush({
          hook,
          delegate: delegate(['vp', 'run', 'check:local']),
          graph: GRAPH,
          ci: CI,
        }),
      ).toEqual([])
      expect(
        checkPrePush({
          hook,
          delegate: delegate(['vp', 'run', 'check:push']),
          graph: GRAPH,
          ci: CI,
        }).map((violation) => violation.rule),
      ).toEqual(['pre-push/hook'])
      expect(
        checkPrePush({
          hook: 'exec node scripts/other.ts\n',
          delegate: delegate(['vp', 'run', 'check:local']),
          graph: GRAPH,
          ci: CI,
        }).map((violation) => violation.rule),
      ).toEqual(['pre-push/hook'])
    })

    it('reports a task of CI that check:local misses, and one only check:local runs', () => {
      const ci = `${CI}      - run: vp run test:acceptance\n`
      const graph = { 'check:local': ['check:push', 'lint:extra'], 'check:push': [] }
      expect(checkPrePush({ hook: HOOK, graph, ci }).map((violation) => violation.rule)).toEqual([
        'pre-push/missing',
        'pre-push/local-only',
      ])
    })

    it('reports a task of CI_ONLY that CI no longer runs', () => {
      const ci = 'jobs:\n  a:\n    steps:\n      - run: vp run check:push\n'
      expect(
        checkPrePush({ hook: HOOK, graph: GRAPH, ci }).map((violation) => violation.rule),
      ).toEqual(['pre-push/stale'])
    })
  })
})
