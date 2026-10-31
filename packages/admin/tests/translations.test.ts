import { describe, expect, it } from 'vite-plus/test'

import { sourceWhenTranslated } from '../app/lib/translations.ts'

describe('the source of a translation that fell behind', () => {
  const source = [
    { id: 'c', createdAt: '2026-10-30T12:00:00.000Z' },
    { id: 'b', createdAt: '2026-10-29T12:00:00.000Z' },
    { id: 'a', createdAt: '2026-10-28T12:00:00.000Z' },
  ]

  it('is read as it was when the translation was saved, not as it is now', () => {
    expect(sourceWhenTranslated(source, '2026-10-29T18:00:00.000Z')?.id).toBe('b')
    expect(sourceWhenTranslated(source, '2026-10-29T12:00:00.000Z')?.id).toBe('b')
    expect(sourceWhenTranslated(source, '2026-10-27T12:00:00.000Z')).toBeUndefined()
  })
})
