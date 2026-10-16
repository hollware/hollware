<script setup lang="ts">
import type { CommandPaletteGroup, DropdownMenuItem, NavigationMenuItem } from '@nuxt/ui'
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { api, auth } from './lib/session.ts'

/**
 * The shell of the admin, as Linear lays one out with Nuxt UI's dashboard: the site to work in
 * at the top of a sidebar, search on ⌘K, the sections with their icons, and the person at the
 * foot; each page is a panel beside it.
 */

/** What `/v1/admin/me` says: the person, the site of the token and the sites they may switch to. */
interface Me {
  readonly user: { readonly id: string; readonly name: string | null } | undefined
  readonly site: string
  readonly sites: readonly { readonly site: string; readonly role: string }[]
}

const route = useRoute()
const me = ref<Me | null>(null)
const pending = ref(0)
const collections = ref<string[]>([])

// Once a page that needs a token is reached, never on the callback, which has none yet.
watch(
  () => route.matched.length > 0 && route.meta['open'] !== true,
  async (signed) => {
    if (!signed || me.value !== null) return
    me.value = await api.admin<Me>('me')
    const [reviews, site] = await Promise.all([
      api.call('list_reviews', { status: 'pending', limit: 50 }),
      api.call('describe_site', {}),
    ])
    pending.value = reviews.reviews.length
    collections.value = site.site.collections.map((collection) => collection.name)
  },
  { immediate: true },
)

const role = computed(() => me.value?.sites.find((m) => m.site === me.value?.site)?.role ?? '')

/** The sites of the person, to switch to: a token is for one site, so the admin signs in again. */
const siteItems = computed<DropdownMenuItem[][]>(() => [
  (me.value?.sites ?? []).map((membership) => ({
    label: membership.site,
    description: membership.role,
    icon: 'i-lucide-globe',
    checked: membership.site === me.value?.site,
    type: 'checkbox' as const,
    onSelect: () => {
      if (membership.site !== me.value?.site) void auth.switchSite(membership.site, '/admin/')
    },
  })),
  [{ label: 'New site', icon: 'i-lucide-plus', to: '/site' }],
])

const links = computed<NavigationMenuItem[][]>(() => [
  [
    { label: 'Home', icon: 'i-lucide-house', to: '/', exact: true },
    { label: 'Entries', icon: 'i-lucide-file-text', to: '/entries' },
    {
      label: 'Reviews',
      icon: 'i-lucide-inbox',
      to: '/reviews',
      ...(pending.value > 0 ? { badge: String(pending.value) } : {}),
    },
  ],
  [
    { label: 'Structure', type: 'label' },
    {
      // A trigger with no link of its own: one with both marks a span as expanded, which axe refuses.
      label: 'Collections',
      icon: 'i-lucide-layers',
      defaultOpen: true,
      children: [
        { label: 'All collections', to: '/collections', exact: true },
        ...collections.value.map((name) => ({ label: name, to: `/collections/${name}` })),
      ],
    },
    { label: 'Site', icon: 'i-lucide-globe', to: '/site' },
  ],
  [
    { label: 'Settings', type: 'label' },
    { label: 'People', icon: 'i-lucide-users', to: '/people' },
    { label: 'Tokens', icon: 'i-lucide-key-round', to: '/tokens' },
  ],
])

const searchGroups = computed<CommandPaletteGroup[]>(() => [
  {
    id: 'go',
    label: 'Go to',
    items: links.value
      .flat()
      .flatMap((item) =>
        item.type === 'label' || item.to === undefined
          ? []
          : [{ label: String(item.label), icon: item.icon, to: item.to }],
      ),
  },
  {
    id: 'collections',
    label: 'Collections',
    items: collections.value.map((name) => ({
      label: name,
      icon: 'i-lucide-layers',
      to: `/collections/${name}`,
    })),
  },
  {
    id: 'create',
    label: 'Create',
    items: [
      { label: 'New entry', icon: 'i-lucide-plus', to: '/entries/new' },
      { label: 'New site', icon: 'i-lucide-plus', to: '/site' },
    ],
  },
])

const personItems = computed<DropdownMenuItem[][]>(() => [
  [
    {
      label: me.value?.user?.name ?? 'You',
      description: `${role.value} of ${me.value?.site ?? ''}`,
      type: 'label',
    },
  ],
  [
    { label: 'Tokens', icon: 'i-lucide-key-round', to: '/tokens' },
    { label: 'People', icon: 'i-lucide-users', to: '/people' },
  ],
])

const initial = computed(() => (me.value?.user?.name ?? '?').trim().charAt(0).toUpperCase())
</script>

<template>
  <UApp>
    <RouterView v-if="route.meta['open'] === true" />
    <UDashboardGroup v-else unit="rem">
      <UDashboardSidebar
        id="admin"
        collapsible
        resizable
        :default-size="15"
        :min-size="12"
        :max-size="22"
        class="bg-elevated/25"
        :ui="{ footer: 'border-t border-default' }"
      >
        <template #header="{ collapsed }">
          <UDropdownMenu :items="siteItems" :content="{ align: 'start' }" :ui="{ content: 'w-56' }">
            <UButton
              color="neutral"
              variant="ghost"
              block
              :square="collapsed"
              :trailing-icon="collapsed ? undefined : 'i-lucide-chevrons-up-down'"
              class="data-[state=open]:bg-elevated"
              :ui="{ trailingIcon: 'text-dimmed ms-auto' }"
              aria-label="Site"
            >
              <svg viewBox="0 0 32 32" class="size-5 shrink-0" aria-hidden="true">
                <rect width="32" height="32" rx="8" class="fill-(--ui-bg-accented)" />
                <path
                  d="M9 8v16M23 8v16M9 16h14"
                  class="stroke-primary"
                  stroke-width="3"
                  stroke-linecap="round"
                  fill="none"
                />
              </svg>
              <span v-if="!collapsed" class="truncate font-semibold text-highlighted">{{
                me?.site ?? 'Hollware'
              }}</span>
            </UButton>
          </UDropdownMenu>
        </template>

        <template #default="{ collapsed }">
          <UDashboardSearchButton :collapsed="collapsed" class="bg-transparent ring-default" />
          <UNavigationMenu
            v-for="(group, index) in links"
            :key="index"
            :collapsed="collapsed"
            :items="group"
            orientation="vertical"
            tooltip
            popover
            :class="index === links.length - 1 ? 'mt-auto' : undefined"
          />
        </template>

        <template #footer="{ collapsed }">
          <UDropdownMenu
            :items="personItems"
            :content="{ align: 'start', side: 'top' }"
            :ui="{ content: 'w-56' }"
          >
            <UButton
              color="neutral"
              variant="ghost"
              block
              :square="collapsed"
              class="data-[state=open]:bg-elevated"
              aria-label="You"
            >
              <UAvatar :text="initial" size="2xs" />
              <span v-if="!collapsed" class="truncate">{{ me?.user?.name ?? '' }}</span>
              <span v-if="!collapsed" class="ms-auto font-mono text-xs text-dimmed">{{
                role
              }}</span>
            </UButton>
          </UDropdownMenu>
        </template>
      </UDashboardSidebar>

      <UDashboardSearch :groups="searchGroups" :color-mode="false" />

      <RouterView />
    </UDashboardGroup>
  </UApp>
</template>
