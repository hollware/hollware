import { FORMER_PERSON } from '@hollware/core'
import { describe, expect, it } from 'vite-plus/test'

import { invitationBody, personName } from '../app/lib/people.ts'

describe('the name the admin gives a person', () => {
  it('is their name, else their id, and the former member for one an owner anonymized', () => {
    expect([
      personName('usr_1', 'Olga', 'A former member'),
      personName('usr_1', null, 'A former member'),
      personName(FORMER_PERSON, 'Former member', 'Un antiguo miembro'),
    ]).toEqual(['Olga', 'usr_1', 'Un antiguo miembro'])
  })
})

describe('the body of an invitation', () => {
  it('names the address only when one is given', () => {
    expect([invitationBody('author', '  '), invitationBody('editor', ' ada@example.org ')]).toEqual(
      [{ role: 'author' }, { role: 'editor', email: 'ada@example.org' }],
    )
  })
})
