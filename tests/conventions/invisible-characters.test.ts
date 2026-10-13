import { describe, expect, it } from 'vite-plus/test'

import { exceptionValues, INVISIBLE_CHARACTER_FILES } from '../guards/exceptions.ts'
import { checkInvisibleCharacters } from '../guards/invisible-characters.ts'
import { describeViolations } from '../guards/types.ts'
import { file } from '../support/fixtures.ts'
import { readTextUnlessBinary, repoFiles } from '../support/repo.ts'

// Fails when: a text file of the repository holds a bidirectional control, a zero-width mark, a
// byte order mark or a line or paragraph separator outside INVISIBLE_CHARACTER_FILES; or a file
// of that list stops holding one. The characters are built here with String.fromCodePoint, so
// that this file holds none of them itself.

const RIGHT_TO_LEFT_OVERRIDE = String.fromCodePoint(0x202e)
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b)
const BYTE_ORDER_MARK = String.fromCodePoint(0xfeff)
const LINE_SEPARATOR = String.fromCodePoint(0x2028)

describe('invisible characters', () => {
  it('no text file of the repository holds one, but the files allowed to', () => {
    const files = repoFiles().flatMap((path) => {
      const text = readTextUnlessBinary(path)
      return text === undefined ? [] : [file(path, text)]
    })
    expect(files.length).toBeGreaterThan(300)
    const violations = checkInvisibleCharacters({
      files,
      allowed: exceptionValues(INVISIBLE_CHARACTER_FILES),
    })
    expect(describeViolations(violations)).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    const check = (text: string, allowed: string[] = []) =>
      checkInvisibleCharacters({ files: [file('src/a.ts', text)], allowed })

    it('reports a bidirectional control with its line and code point', () => {
      expect(check(`const ok = true\nconst admin = 'user${RIGHT_TO_LEFT_OVERRIDE}'\n`)).toEqual([
        {
          rule: 'invisible-characters/found',
          file: 'src/a.ts',
          message:
            'line 2 holds the invisible character U+202E: remove it, or write it as an escape or with String.fromCodePoint',
        },
      ])
    })

    it('reports a zero-width mark, a byte order mark and a line separator', () => {
      const codePoints = [ZERO_WIDTH_SPACE, BYTE_ORDER_MARK, LINE_SEPARATOR].map(
        (character) => /U\+[0-9A-F]{4}/.exec(check(`a${character}b`)[0]?.message ?? '')?.[0],
      )
      expect(codePoints).toEqual(['U+200B', 'U+FEFF', 'U+2028'])
    })

    it('accepts an escape, a plain non-breaking space and an allowed file', () => {
      const escape = `const mark = '${String.fromCharCode(92)}u202E'\n`
      expect(check(escape)).toEqual([])
      expect(check(`a${String.fromCodePoint(0xa0)}b`)).toEqual([])
      expect(check(`${BYTE_ORDER_MARK}---\n`, ['src/a.ts'])).toEqual([])
    })

    it('reports an allowed file that holds no invisible character any more', () => {
      expect(check('plain\n', ['src/a.ts'])).toEqual([
        {
          rule: 'invisible-characters/stale-exception',
          file: 'tests/guards/exceptions.ts',
          message:
            'src/a.ts holds no invisible character any more: remove it from INVISIBLE_CHARACTER_FILES and lower its max',
        },
      ])
    })
  })
})
