import { describe, expect, it } from 'vite-plus/test'
import rootConfig from '../../vite.config.ts'
import { checkBuildOrder } from '../guards/build-order.ts'
import { describeViolations } from '../guards/types.ts'
import { isStringArray, recordAt } from '../support/values.ts'

// Fails when: check:push in the root vite.config.ts builds (vp run -r build, vp pack, vp build)
// before it type-checks or tests, or stops running vp check or vp test.

function checkPushCommands(): string[] | undefined {
  const config: unknown = rootConfig
  const command = recordAt(recordAt(recordAt(config, 'run'), 'tasks'), 'check:push')?.command
  if (typeof command === 'string') return [command]
  return isStringArray(command) ? command : undefined
}

describe('build order', () => {
  it('check:push type-checks and tests before anything builds', () => {
    expect(describeViolations(checkBuildOrder({ commands: checkPushCommands() }))).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    it('accepts the type check and the tests before the build', () => {
      expect(
        checkBuildOrder({
          commands: ['vp check', 'vp test', 'vp run -r build', 'vp run -r publint'],
        }),
      ).toEqual([])
    })

    it('reports a build between the type check and the tests', () => {
      expect(checkBuildOrder({ commands: ['vp check', 'vp run -r build', 'vp test'] })).toEqual([
        {
          rule: 'build-order/build-first',
          file: 'vite.config.ts',
          message:
            'check:push runs "vp run -r build" before "vp test": the tests must run before anything builds, or a package that resolves to dist/ again goes unnoticed (ADR-016)',
        },
      ])
    })

    it('counts vp pack and vp build as builds', () => {
      const messages = (first: string) =>
        checkBuildOrder({ commands: [first, 'vp check', 'vp test'] }).map(
          (violation) => violation.message,
        )
      expect(messages('vp pack')).toEqual([
        'check:push runs "vp pack" before "vp check": the type check must run before anything builds, or a package that resolves to dist/ again goes unnoticed (ADR-016)',
        'check:push runs "vp pack" before "vp test": the tests must run before anything builds, or a package that resolves to dist/ again goes unnoticed (ADR-016)',
      ])
      expect(messages('vp build --mode production')).toHaveLength(2)
      expect(messages('vp run publint')).toEqual([])
    })

    it('reports a missing step and a missing task', () => {
      expect(checkBuildOrder({ commands: ['vp check', 'vp run -r build'] })).toEqual([
        {
          rule: 'build-order/missing-step',
          file: 'vite.config.ts',
          message: 'check:push never runs "vp test"',
        },
      ])
      expect(checkBuildOrder({ commands: undefined })).toEqual([
        {
          rule: 'build-order/no-task',
          file: 'vite.config.ts',
          message: 'the root vite.config.ts has no check:push task with commands',
        },
      ])
    })
  })
})
