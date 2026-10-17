import { describe, expect, it } from 'vite-plus/test'

import {
  edgeHeaders,
  entryTags,
  groupTags,
  listTags,
  previewOf,
  recordTags,
  tagsOf,
} from '../src/runtime/tags.ts'

// Fails when: the cache tags of a response (src/runtime/tags.ts) stop gathering on its request
// what each read showed, once each, in the names of @hollware/core; a list stops naming its locale,
// or every locale when it has none; or the edge is let keep an error, a write or a response that
// read nothing, or the browser is let keep anything.

describe('the tags of a response', () => {
  it('gather what each read showed, once each', () => {
    const event = { context: {} }
    const entry = { id: 'ent_1' }

    recordTags(event, entryTags(entry))
    recordTags(event, listTags('blog', undefined, [entry, { id: 'ent_2' }]))
    recordTags(event, groupTags('blog', 'hola', [entry]))

    expect(tagsOf(event)).toEqual(['entry:ent_1', 'list:blog:*', 'entry:ent_2', 'group:blog:hola'])
    expect(listTags('blog', 'es', [])).toEqual(['list:blog:es'])
  })

  it('let the edge keep a GET that answered 200 and read Hollware, and nothing else', () => {
    expect(edgeHeaders(['entry:ent_1'], 200, 'GET')).toEqual({
      'cache-tag': 'entry:ent_1',
      'cache-control': 'public, max-age=0, must-revalidate',
      'cloudflare-cdn-cache-control': 'max-age=31536000',
    })
    expect([
      edgeHeaders(['entry:ent_1'], 404, 'GET'),
      edgeHeaders(['entry:ent_1'], 200, 'POST'),
      edgeHeaders([], 200, 'GET'),
    ]).toEqual([null, null, null])
  })
})

describe('the preview token of a URL', () => {
  it('is the non-empty string of hollware-preview, and nothing else', () => {
    expect([
      previewOf({ 'hollware-preview': 'hw_prv_a.b' }),
      previewOf({ 'hollware-preview': '' }),
      previewOf({ 'hollware-preview': ['x', 'y'] }),
      previewOf({ preview: 'hw_prv_a.b' }),
      previewOf({}),
    ]).toEqual(['hw_prv_a.b', undefined, undefined, undefined, undefined])
  })
})
