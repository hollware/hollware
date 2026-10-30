import { describe, expect, it } from 'vite-plus/test'

import { accessForm, accessOf } from '../app/lib/access.ts'

describe('the sign-in policy of a site, as the admin edits it', () => {
  it('reads a policy into the form, and nobody let in as an empty form that is off', () => {
    expect(
      accessForm({
        autoProvision: {
          domains: ['acme.com', 'acme.org'],
          emails: ['ada@else.org'],
          role: 'editor',
        },
      }),
    ).toEqual({ on: true, domains: 'acme.com\nacme.org', emails: 'ada@else.org', role: 'editor' })
    expect(accessForm({ autoProvision: null })).toEqual({
      on: false,
      domains: '',
      emails: '',
      role: 'author',
    })
  })

  it('writes the lists one per line or comma, in lowercase, each once, without a leading @', () => {
    expect(
      accessOf({
        on: true,
        domains: ' @ACME.com\nacme.com, acme.org ',
        emails: 'Ada@Else.org;  ',
        role: 'author',
      }),
    ).toEqual({
      autoProvision: {
        domains: ['acme.com', 'acme.org'],
        emails: ['ada@else.org'],
        role: 'author',
      },
    })
  })

  it('lets nobody in when it is off, and refuses a policy on with no domain and no address', () => {
    expect(accessOf({ on: false, domains: 'acme.com', emails: '', role: 'editor' })).toEqual({
      autoProvision: null,
    })
    expect(accessOf({ on: true, domains: ' ', emails: ',', role: 'editor' })).toBe('empty')
  })
})
