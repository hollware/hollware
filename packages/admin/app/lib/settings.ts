export type SettingsKey = 'site' | 'collections' | 'people' | 'tokens' | 'activity' | 'account'

export interface SettingsSection {
  readonly key: SettingsKey
  readonly icon: string
  readonly to: string
}

const SECTIONS: readonly SettingsSection[] = [
  { key: 'site', icon: 'i-lucide-globe', to: '/settings/site' },
  { key: 'collections', icon: 'i-lucide-layers', to: '/settings/collections' },
  { key: 'people', icon: 'i-lucide-users', to: '/settings/people' },
  { key: 'tokens', icon: 'i-lucide-key-round', to: '/settings/tokens' },
  { key: 'activity', icon: 'i-lucide-scroll-text', to: '/settings/activity' },
  { key: 'account', icon: 'i-lucide-circle-user', to: '/settings/account' },
]

export function settingsSections(owner: boolean): SettingsSection[] {
  return SECTIONS.filter((section) => owner || section.key !== 'activity')
}
