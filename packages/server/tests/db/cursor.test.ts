import { HollwareError } from '@hollware/core'
import { describe, expect, it } from 'vite-plus/test'

import { decodeCursor, encodeCursor } from '../../src/db/cursor.ts'

// Fails when: src/db/cursor.ts changes the format of a cursor (base64url of the JSON of the view,
// the sort key and the id, which would invalidate every cursor a client holds), stops carrying the
// view or the sort key or the id, stops being safe for non-ASCII keys, accepts a cursor that no
// listing returned (not base64url, not UTF-8, not JSON, the wrong shape, another view's), or
// raises it as anything but the error `invalid_input` with a fix.

const HEAD_CURSOR = 'eyJ2IjoiaGVhZCIsImsiOiIyMDI2LTEwLTEyVDEwOjAwOjAwLjAwMFoiLCJpIjoiZW50XzEifQ'

function base64Url(text: string): string {
  return btoa(text).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function rejection(call: () => unknown): HollwareError {
  try {
    call()
  } catch (error) {
    if (error instanceof HollwareError) return error
    throw error
  }
  throw new Error('The call did not throw')
}

describe('a cursor', () => {
  it('is the base64url of the JSON of the view, the sort key and the id', () => {
    expect(encodeCursor('head', { key: '2026-10-12T10:00:00.000Z', id: 'ent_1' })).toBe(HEAD_CURSOR)
    expect(atob(HEAD_CURSOR.replaceAll('-', '+').replaceAll('_', '/'))).toBe(
      '{"v":"head","k":"2026-10-12T10:00:00.000Z","i":"ent_1"}',
    )
  })

  it('decodes to the position it was made from, in the view it was made for', () => {
    expect(decodeCursor(HEAD_CURSOR, 'head')).toEqual({
      key: '2026-10-12T10:00:00.000Z',
      id: 'ent_1',
    })
    expect(
      decodeCursor(encodeCursor('published', { key: '2026-10-01', id: 'ent_9' }), 'published'),
    ).toEqual({ key: '2026-10-01', id: 'ent_9' })
  })

  it('survives a sort key that is not ASCII, and one that base64 would pad', () => {
    const position = { key: 'Diseño del planificador: ñandú 🚀', id: 'ent_é' }
    const cursor = encodeCursor('published', position)
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decodeCursor(cursor, 'published')).toEqual(position)
    const padded = { key: 'a', id: 'b' }
    expect(encodeCursor('head', padded)).not.toContain('=')
    expect(decodeCursor(encodeCursor('head', padded), 'head')).toEqual(padded)
  })

  it.each([
    ['not base64url', 'not a cursor!'],
    ['base64 with a character that is not base64url', 'eyJ2Ijoi+GVhZCJ9'],
    ['base64url of bytes that are not UTF-8', base64Url('\xff\xfe\xfd')],
    ['base64url of text that is not JSON', base64Url('hello')],
    ['base64url of a JSON string', base64Url('"head"')],
    ['base64url of JSON null', base64Url('null')],
    ['an empty cursor', ''],
    ['JSON without a view', base64Url('{"k":"a","i":"b"}')],
    ['JSON without a sort key', base64Url('{"v":"head","i":"b"}')],
    ['JSON without an id', base64Url('{"v":"head","k":"a"}')],
    ['JSON with a sort key that is not text', base64Url('{"v":"head","k":1,"i":"b"}')],
    ['JSON with an id that is not text', base64Url('{"v":"head","k":"a","i":null}')],
    ['the cursor of another view', encodeCursor('published', { key: 'a', id: 'b' })],
  ])('that is %s is the error invalid_input, with a fix', (_label, cursor) => {
    const error = rejection(() => decodeCursor(cursor, 'head'))
    expect(error.code).toBe('invalid_input')
    expect(error.message).toBe('The cursor is not valid for this listing.')
    expect(error.fix).toBe(
      'Pass the nextCursor of the previous answer unchanged, to the same operation, or leave cursor out to start from the first page.',
    )
  })
})
