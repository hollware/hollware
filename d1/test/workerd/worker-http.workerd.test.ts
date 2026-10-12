import { exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { seedEntry } from './support.ts'

// Fails when: src/index.ts stops answering 201 with the new version for a write at the current
// version, 409 {"error":"conflict"} for a stale one, or stops reading entries through the session.

describe('the Worker entry over HTTP', () => {
  it('answers 201 for a write at the current version and 409 for the same write replayed', async () => {
    await seedEntry('ent_http', 1)
    const put = (version: number) =>
      exports.default.fetch(`http://spike.test/entries/ent_http?expectedVersion=${version}`, {
        method: 'PUT',
        body: '# Over HTTP',
      })

    const first = await put(1)
    const replay = await put(1)

    expect([first.status, await first.json()]).toEqual([201, { version: 2 }])
    expect([replay.status, await replay.json()]).toEqual([409, { error: 'conflict' }])
  })

  it('reads the entry through a session', async () => {
    await seedEntry('ent_http_read', 4)

    const response = await exports.default.fetch('http://spike.test/entries/ent_http_read')

    expect([response.status, await response.json()]).toEqual([
      200,
      { id: 'ent_http_read', version: 4, headRev: null },
    ])
  })

  it('answers 404 for a path or an entry it does not serve', async () => {
    const unknownPath = await exports.default.fetch('http://spike.test/nope')
    const unknownEntry = await exports.default.fetch('http://spike.test/entries/ent_none')

    expect([unknownPath.status, unknownEntry.status]).toEqual([404, 404])
  })
})
