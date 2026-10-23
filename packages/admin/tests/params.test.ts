import { describeCatalog } from '@hollware/core'
import { describe, expect, it } from 'vite-plus/test'

import { cleanParams, paramInputs } from '../app/lib/params.ts'

const params = (name: string) => {
  const rule = describeCatalog().find((entry) => entry.name === name)
  if (rule === undefined) throw new Error(`no rule ${name}`)
  return paramInputs(rule.params).map((input) => [input.key, input.kind, input.required])
}

describe('paramInputs', () => {
  it('reads each parameter of the catalog as the input it needs', () => {
    expect(params('field-length')).toEqual([
      ['field', 'field', true],
      ['min', 'number', false],
      ['max', 'number', false],
      ['unless', 'field', false],
    ])
    expect(params('required-to-publish')).toEqual([['fields', 'fields', true]])
    expect(params('banned-words')).toEqual([
      ['words', 'texts', true],
      ['reason', 'text', false],
    ])
    expect(params('images-have-alt')).toEqual([])
  })
})

describe('cleanParams', () => {
  it('leaves out what is empty, and keeps zero and false', () => {
    expect(
      cleanParams({ field: 'title', min: 0, unless: '', words: [], max: undefined, flag: false }),
    ).toEqual({
      field: 'title',
      min: 0,
      flag: false,
    })
  })
})
