import { describe, expect, it } from 'vite-plus/test'

import { invitationOf, setupPage } from '../../src/identity/pages.ts'

describe('invitationOf', () => {
  it.each([
    ['the fragment', '#invitation=hw_inv_a', '', 'hw_inv_a'],
    ['the fragment over the query', '#invitation=hw_inv_a', '?invitation=hw_inv_b', 'hw_inv_a'],
    ['the query of an older link', '', '?invitation=hw_inv_b', 'hw_inv_b'],
    ['nothing when neither has one', '#top', '?x=1', ''],
  ])('reads %s', (_name, hash, search, expected) => {
    expect(invitationOf(hash, search)).toBe(expected)
  })

  it('is the function the setup page runs, and the page never holds an invitation', () => {
    const page = setupPage('0'.repeat(32))
    expect(page).toContain(`const invitationOf = ${invitationOf.toString()}`)
    expect(page).toContain('invitationOf(location.hash, location.search)')
  })
})
