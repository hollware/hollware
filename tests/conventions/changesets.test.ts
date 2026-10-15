import { describe, expect, it } from 'vite-plus/test'
import { checkChangesets } from '../guards/changesets.ts'
import { describeViolations } from '../guards/types.ts'
import { file, goodWorkspace, json, publishedNames } from '../support/fixtures.ts'
import { readText } from '../support/repo.ts'
import { workspaceManifests } from '../support/workspace.ts'

// Fails when: the `fixed` list of .changeset/config.json is not exactly one group holding the
// non-private packages of packages/, or access is not public, baseBranch is not main, or
// private packages would be versioned or tagged.

describe('changeset config', () => {
  it('fixes the seven published packages as one group', () => {
    const violations = checkChangesets({
      config: file('.changeset/config.json', readText('.changeset/config.json')),
      manifests: workspaceManifests(),
    })
    expect(describeViolations(violations)).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    const { manifests } = goodWorkspace()
    const goodConfig = {
      baseBranch: 'main',
      access: 'public',
      fixed: [publishedNames()],
      privatePackages: { version: false, tag: false },
    }
    const check = (config: Record<string, unknown>) =>
      checkChangesets({
        config: file('.changeset/config.json', json({ ...goodConfig, ...config })),
        manifests,
      })

    it('accepts the good fixture', () => {
      expect(check({})).toEqual([])
    })

    it('accepts the group in any order', () => {
      expect(check({ fixed: [[...publishedNames()].reverse()] })).toEqual([])
    })

    it('reports a published package missing from the group', () => {
      const group = publishedNames().filter((name) => name !== 'create-hollware')
      expect(check({ fixed: [group] })).toEqual([
        {
          rule: 'changesets/fixed',
          file: '.changeset/config.json',
          message:
            'the fixed group must be exactly the published packages ["@hollware/admin","@hollware/client","@hollware/core","@hollware/server","create-hollware","hollware"], found ["@hollware/admin","@hollware/client","@hollware/core","@hollware/server","hollware"]',
        },
      ])
    })

    it('reports a private package in the group', () => {
      const result = check({ fixed: [[...publishedNames(), '@hollware/playground']] })
      expect(result.map((violation) => violation.rule)).toEqual(['changesets/fixed'])
    })

    it('reports no group, two groups and a group of the wrong shape', () => {
      const names = publishedNames()
      for (const fixed of [[], [names.slice(0, 3), names.slice(3)], [[1, 2]], 'all']) {
        const result = check({ fixed })
        expect(result.map((violation) => violation.rule)).toEqual(['changesets/fixed'])
      }
      expect(check({ fixed: [] })[0]?.message).toBe(
        '"fixed" must hold exactly one group of package names, found []',
      )
    })

    it('reports restricted access, another base branch and versioned private packages', () => {
      const result = check({
        access: 'restricted',
        baseBranch: 'develop',
        privatePackages: { version: true, tag: false },
      })
      expect(result).toEqual([
        {
          rule: 'changesets/access',
          file: '.changeset/config.json',
          message: '"access" must be "public", found "restricted"',
        },
        {
          rule: 'changesets/base-branch',
          file: '.changeset/config.json',
          message: '"baseBranch" must be "main", found "develop"',
        },
        {
          rule: 'changesets/private-packages',
          file: '.changeset/config.json',
          message:
            '"privatePackages" must be {"version":false,"tag":false}, found {"version":true,"tag":false}',
        },
      ])
    })

    it('reports a config that is not valid JSON', () => {
      const result = checkChangesets({ config: file('.changeset/config.json', '{'), manifests })
      expect(result.map((violation) => violation.rule)).toEqual(['changesets/invalid-json'])
    })
  })
})
