import { describe, expect, it } from 'vite-plus/test'

import {
  edgeHeaders,
  entryTags,
  groupTags,
  listTags,
  recordTags,
  tagsOf,
} from '../src/runtime/tags.ts'

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
      'cache-control': 'public, max-age=0',
      'cloudflare-cdn-cache-control': 'max-age=31536000, stale-if-error=31536000',
    })
    expect([
      edgeHeaders(['entry:ent_1'], 404, 'GET'),
      edgeHeaders(['entry:ent_1'], 200, 'POST'),
      edgeHeaders([], 200, 'GET'),
    ]).toEqual([null, null, null])
  })
})
