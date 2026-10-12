import { describe, expect, it } from 'vite-plus/test'
import { checkServerTypes } from '../guards/server-types.ts'
import { describeViolations } from '../guards/types.ts'
import { file, json } from '../support/fixtures.ts'
import { readRepoFiles } from '../support/repo.ts'

// Fails when: packages/server/tsconfig.json stops covering only src and the generated runtime
// types, or gives src other types (Node's, for example).

describe('server types', () => {
  it('packages/server/src type-checks with the Workers runtime types only', () => {
    const tsconfig = readRepoFiles((path) => path === 'packages/server/tsconfig.json')[0]
    expect(tsconfig?.path).toBe('packages/server/tsconfig.json')
    const violations = checkServerTypes({
      tsconfig: tsconfig ?? file('packages/server/tsconfig.json', '{}'),
    })
    expect(describeViolations(violations)).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    const check = (compilerOptions: object, include: string[]) =>
      checkServerTypes({
        tsconfig: file('packages/server/tsconfig.json', json({ compilerOptions, include })),
      })

    it('accepts the runtime types alone over src', () => {
      expect(
        check({ types: ['./worker-configuration.d.ts'] }, ['worker-configuration.d.ts', 'src']),
      ).toEqual([])
    })

    it("reports Node's types next to the runtime types, and a wider include", () => {
      expect(
        check({ types: ['./worker-configuration.d.ts', 'node'] }, [
          'worker-configuration.d.ts',
          'src',
        ]),
      ).toEqual([
        {
          rule: 'server-types',
          file: 'packages/server/tsconfig.json',
          message:
            'must type-check only src with the generated Workers runtime types, {"include":["worker-configuration.d.ts","src"],"types":["./worker-configuration.d.ts"]}, so that a Node global is a type error; found {"include":["worker-configuration.d.ts","src"],"types":["./worker-configuration.d.ts","node"]}',
        },
      ])
      expect(
        check({ types: ['./worker-configuration.d.ts'] }, [
          'worker-configuration.d.ts',
          'src',
          'tests',
        ]),
      ).toHaveLength(1)
    })

    it('reports a tsconfig that does not parse', () => {
      const result = checkServerTypes({
        tsconfig: file('packages/server/tsconfig.json', '{ "include": '),
      })
      expect(result.map((violation) => violation.rule)).toEqual(['server-types'])
      expect(result[0]?.message).toMatch(/^the file does not parse, so it cannot be checked: /)
    })
  })
})
