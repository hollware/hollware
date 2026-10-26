export type SettingsGroupKey = 'site' | 'access' | 'you'

export type SettingsKey =
  | 'general'
  | 'collections'
  | 'images'
  | 'webhooks'
  | 'analytics'
  | 'backups'
  | 'redirects'
  | 'danger'
  | 'people'
  | 'tokens'
  | 'activity'
  | 'account'

export interface SettingsSection {
  readonly key: SettingsKey
  readonly icon: string
  readonly to: string
  readonly exact: boolean
}

export interface SettingsGroup {
  readonly key: SettingsGroupKey
  readonly sections: readonly SettingsSection[]
}

const section = (key: SettingsKey, icon: string, to: string, exact = false): SettingsSection => ({
  key,
  icon,
  to,
  exact,
})

const GROUPS: readonly SettingsGroup[] = [
  {
    key: 'site',
    sections: [
      section('general', 'i-lucide-globe', '/settings/site', true),
      section('collections', 'i-lucide-layers', '/settings/collections'),
      section('images', 'i-lucide-image', '/settings/site/images'),
      section('webhooks', 'i-lucide-webhook', '/settings/site/webhooks'),
      section('analytics', 'i-lucide-chart-line', '/settings/site/analytics'),
      section('backups', 'i-lucide-archive', '/settings/site/backups'),
      section('redirects', 'i-lucide-corner-down-right', '/settings/site/redirects'),
      section('danger', 'i-lucide-triangle-alert', '/settings/site/danger'),
    ],
  },
  {
    key: 'access',
    sections: [
      section('people', 'i-lucide-users', '/settings/people'),
      section('tokens', 'i-lucide-key-round', '/settings/tokens'),
      section('activity', 'i-lucide-scroll-text', '/settings/activity'),
    ],
  },
  {
    key: 'you',
    sections: [section('account', 'i-lucide-circle-user', '/settings/account')],
  },
]

const OWNER_ONLY: ReadonlySet<SettingsKey> = new Set(['activity', 'danger'])

export function settingsGroups(owner: boolean): SettingsGroup[] {
  return GROUPS.map((group) => ({
    key: group.key,
    sections: group.sections.filter((one) => owner || !OWNER_ONLY.has(one.key)),
  }))
}
