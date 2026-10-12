import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { checkNoClaudeMd } from '../guards/claude-md.ts'
import { describeViolations } from '../guards/types.ts'
import { repoFiles, workingTreeFiles } from '../support/repo.ts'

// Fails when: a file named CLAUDE.md (in any case, a symlink included) exists anywhere in the
// repository or in its working tree outside node_modules, tracked or not.

describe('no CLAUDE.md', () => {
  it('there is none in the repository or in the working tree', () => {
    const violations = checkNoClaudeMd({ paths: [...repoFiles(), ...workingTreeFiles()] })
    expect(describeViolations(violations)).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    it('accepts a tree with AGENTS.md only', () => {
      expect(checkNoClaudeMd({ paths: ['AGENTS.md', 'packages/core/AGENTS.md'] })).toEqual([])
    })

    it('reports a CLAUDE.md at the root, nested, in another case, and in a dot directory', () => {
      const paths = ['CLAUDE.md', 'packages/core/claude.md', 'docs/Claude.MD', '.claude/CLAUDE.md']
      expect(checkNoClaudeMd({ paths }).map((violation) => violation.file)).toEqual([
        '.claude/CLAUDE.md',
        'CLAUDE.md',
        'docs/Claude.MD',
        'packages/core/claude.md',
      ])
    })

    it('reports the exact violation', () => {
      expect(checkNoClaudeMd({ paths: ['CLAUDE.md', 'CLAUDE.md'] })).toEqual([
        {
          rule: 'no-claude-md/present',
          file: 'CLAUDE.md',
          message: 'there must be no CLAUDE.md: delete it and put the guidance in AGENTS.md',
        },
      ])
    })

    it('leaves alone names that merely contain it', () => {
      expect(
        checkNoClaudeMd({ paths: ['CLAUDE.md.bak', 'docs/not-claude.md', 'CLAUDE.mdx'] }),
      ).toEqual([])
    })
  })

  describe('the working-tree walk', () => {
    let root: string

    afterEach(() => {
      rmSync(root, { recursive: true, force: true })
    })

    it('finds an untracked file and a symlink, and skips node_modules and .git', () => {
      root = mkdtempSync(join(tmpdir(), 'no-claude-md-'))
      mkdirSync(join(root, 'a/b'), { recursive: true })
      mkdirSync(join(root, 'node_modules/pkg'), { recursive: true })
      mkdirSync(join(root, '.git/hooks'), { recursive: true })
      writeFileSync(join(root, 'AGENTS.md'), 'agents')
      writeFileSync(join(root, 'a/b/CLAUDE.md'), 'untracked')
      writeFileSync(join(root, 'node_modules/pkg/CLAUDE.md'), 'dependency')
      writeFileSync(join(root, '.git/hooks/CLAUDE.md'), 'git internals')
      symlinkSync('AGENTS.md', join(root, 'CLAUDE.md'))

      const paths = workingTreeFiles(root)

      expect(paths).toEqual(['AGENTS.md', 'CLAUDE.md', 'a/b/CLAUDE.md'])
      expect(checkNoClaudeMd({ paths }).map((violation) => violation.file)).toEqual([
        'CLAUDE.md',
        'a/b/CLAUDE.md',
      ])
    })
  })
})
