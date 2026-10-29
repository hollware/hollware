import { describe, expect, it } from 'vite-plus/test'

import { settingsGroups } from '../app/lib/settings.ts'

const keys = (owner: boolean) =>
  settingsGroups(owner).map((group) => [group.key, group.sections.map((section) => section.key)])

describe('the navigation of the settings', () => {
  it('groups the site, who reaches it, and you, in the order of the sidebar', () => {
    expect(keys(true)).toEqual([
      [
        'site',
        [
          'general',
          'collections',
          'images',
          'webhooks',
          'analytics',
          'backups',
          'redirects',
          'danger',
        ],
      ],
      ['access', ['people', 'signin', 'tokens', 'activity']],
      ['you', ['account']],
    ])
  })

  it('shows the activity log, the danger zone and the sign-in policy to an owner only', () => {
    expect(keys(false)).toEqual([
      [
        'site',
        ['general', 'collections', 'images', 'webhooks', 'analytics', 'backups', 'redirects'],
      ],
      ['access', ['people', 'tokens']],
      ['you', ['account']],
    ])
  })

  it('gives each part of the site a page of its own, and matches General alone exactly', () => {
    const site = settingsGroups(true)[0]?.sections ?? []
    expect(site.map(({ to, exact }) => [to, exact])).toEqual([
      ['/settings/site', true],
      ['/settings/collections', false],
      ['/settings/site/images', false],
      ['/settings/site/webhooks', false],
      ['/settings/site/analytics', false],
      ['/settings/site/backups', false],
      ['/settings/site/redirects', false],
      ['/settings/site/danger', false],
    ])
  })
})
