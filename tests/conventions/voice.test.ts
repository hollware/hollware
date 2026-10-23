import { describe, expect, it } from 'vite-plus/test'

import { describeViolations } from '../guards/types.ts'
import { checkVoice } from '../guards/voice.ts'
import { file } from '../support/fixtures.ts'
import { readTextUnlessBinary, repoFiles } from '../support/repo.ts'

describe('the voice of Hollware', () => {
  it('no text file of the repository uses a word Hollware never says', () => {
    const files = repoFiles()
      .filter((path) => path !== 'pnpm-lock.yaml' && !path.endsWith('CHANGELOG.md'))
      .flatMap((path) => {
        const text = readTextUnlessBinary(path)
        return text === undefined ? [] : [file(path, text)]
      })
    expect(files.length).toBeGreaterThan(300)
    expect(describeViolations(checkVoice(files))).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    it('reports each word with its line, whatever its case', () => {
      const text = `# Hollware\n\nThe ${'AI-'}powered CMS that ${'un'}leashes content.\n${'Spo'}oky!\n`
      expect(checkVoice([file('README.md', text)])).toEqual([
        {
          rule: 'voice/never',
          file: 'README.md',
          message: `line 3 says "${'AI-'}powered": say what happens instead (apps/web/AGENTS.md)`,
        },
        {
          rule: 'voice/never',
          file: 'README.md',
          message: `line 3 says "${'un'}leashes": say what happens instead (apps/web/AGENTS.md)`,
        },
        {
          rule: 'voice/never',
          file: 'README.md',
          message: `line 4 says "${'Spo'}oky": say what happens instead (apps/web/AGENTS.md)`,
        },
      ])
    })

    it('accepts the words that only contain one', () => {
      expect(checkVoice([file('a.md', 'autopilots? no: seamstress, leash, generation\n')])).toEqual(
        [],
      )
    })
  })
})
