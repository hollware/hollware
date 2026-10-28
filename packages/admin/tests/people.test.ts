import { FORMER_PERSON } from '@hollware/core'
import { describe, expect, it } from 'vite-plus/test'

import { personName } from '../app/lib/people.ts'

describe('the name the admin gives a person', () => {
  it('is their name, else their id, and the former member for one an owner anonymized', () => {
    expect([
      personName('usr_1', 'Olga', 'A former member'),
      personName('usr_1', null, 'A former member'),
      personName(FORMER_PERSON, 'Former member', 'Un antiguo miembro'),
    ]).toEqual(['Olga', 'usr_1', 'Un antiguo miembro'])
  })
})
