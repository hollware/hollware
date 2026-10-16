import type { DropdownMenuItem } from '@nuxt/ui'
import { computed, ref } from 'vue'
import { useMessages } from '../i18n/index.ts'
import { auth } from './session.ts'

/** What `/v1/admin/me` says: the person, the site of the token and the sites they may switch to. */
export interface Me {
  readonly user: { readonly id: string; readonly name: string | null } | undefined
  readonly site: string
  readonly sites: readonly { readonly site: string; readonly role: string }[]
}

/** The person signed in, once the shell has asked: every page reads the site it works in here. */
export const me = ref<Me | null>(null)

/**
 * The sites of the person, to switch to, and a new one: a token is for one site, so the admin
 * signs in again on the one chosen. The sidebar and the bar of every page show the same menu.
 */
export function useSiteMenu() {
  const m = useMessages()
  return computed<DropdownMenuItem[][]>(() => [
    (me.value?.sites ?? []).map((membership) => ({
      label: membership.site,
      description: m.value.roles[membership.role] ?? membership.role,
      icon: 'i-lucide-globe',
      checked: membership.site === me.value?.site,
      type: 'checkbox' as const,
      onSelect: () => {
        if (membership.site !== me.value?.site) void auth.switchSite(membership.site, '/admin/')
      },
    })),
    [{ label: m.value.nav.newSite, icon: 'i-lucide-plus', to: '/site' }],
  ])
}
