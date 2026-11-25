import { describe, expect, it } from 'vite-plus/test'

import { editorName, initialsOf, isNewer } from '../app/lib/presence.ts'

const ana = { id: 'usr_01ANA', name: 'Ana Pérez', kind: 'person' as const }

describe('the presence of others in an entry', () => {
  it('knows a version is newer only when it is past the one being edited', () => {
    const latest = { version: 5, savedAt: '2026-11-25T12:00:00.000Z', savedBy: ana }

    expect([
      isNewer(latest, 4),
      isNewer(latest, 5),
      isNewer(latest, 6),
      isNewer(null, 4),
      isNewer(latest, null),
    ]).toEqual([true, false, false, false, false])
  })

  it('names an editor by their name, and by the fallback when they have none', () => {
    expect(editorName(ana, 'Someone')).toBe('Ana Pérez')
    expect(editorName({ ...ana, name: '  ' }, 'Someone')).toBe('Someone')
    expect(editorName(null, 'Someone')).toBe('Someone')
  })

  it('shows the initials of the first two words, or the end of the id without a name', () => {
    expect(initialsOf(ana)).toBe('AP')
    expect(initialsOf({ ...ana, name: 'claude' })).toBe('C')
    expect(initialsOf({ ...ana, name: null })).toBe('NA')
  })
})
