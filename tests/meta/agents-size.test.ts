import { describe, expect, it } from 'vite-plus/test'
import { checkAgentsSize, MAX_AGENTS_CHARACTERS } from '../guards/agents-size.ts'
import { describeViolations } from '../guards/types.ts'
import { file } from '../support/fixtures.ts'
import { isAgentsFile, readRepoFiles } from '../support/repo.ts'

// Fails when: any AGENTS.md of the repository, root or nested, is longer than 12,000 characters.

describe('AGENTS.md size', () => {
  it('every AGENTS.md fits in 12,000 characters', () => {
    const docs = readRepoFiles(isAgentsFile)
    expect(MAX_AGENTS_CHARACTERS).toBe(12_000)
    expect(docs.length).toBeGreaterThanOrEqual(8)
    expect(describeViolations(checkAgentsSize({ docs, max: MAX_AGENTS_CHARACTERS }))).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    it('accepts a file exactly at the limit', () => {
      expect(
        checkAgentsSize({ docs: [file('AGENTS.md', 'x'.repeat(12_000))], max: 12_000 }),
      ).toEqual([])
    })

    it('reports a file one character over the limit', () => {
      expect(
        checkAgentsSize({
          docs: [file('packages/core/AGENTS.md', 'x'.repeat(12_001))],
          max: 12_000,
        }),
      ).toEqual([
        {
          rule: 'agents-size/too-long',
          file: 'packages/core/AGENTS.md',
          message:
            'the file has 12001 characters, 1 over the limit of 12000: move detail into a test, a lint rule or a nested AGENTS.md',
        },
      ])
    })

    it('counts characters, not UTF-16 units or bytes', () => {
      // 6,000 emoji are 12,000 UTF-16 units and 24,000 bytes, but 6,000 characters.
      expect(
        checkAgentsSize({ docs: [file('AGENTS.md', '\u{1F600}'.repeat(6_000))], max: 12_000 }),
      ).toEqual([])
      expect(
        checkAgentsSize({ docs: [file('AGENTS.md', '\u{1F600}'.repeat(12_001))], max: 12_000 }),
      ).toHaveLength(1)
    })
  })
})
