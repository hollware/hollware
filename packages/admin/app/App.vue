<script setup lang="ts">
import type { CommandPaletteGroup, DropdownMenuItem, NavigationMenuItem } from '@nuxt/ui'
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { currentLocale, LANGUAGES, setLocale, uiLocale, useMessages } from './i18n/index.ts'
import type { Output } from './lib/api.ts'
import { entryPath, titleOf } from './lib/entries.ts'
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
const m = useMessages()
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

const roleKey = computed(
  () => me.value?.sites.find((membership) => membership.site === me.value?.site)?.role ?? '',
)
const role = computed(() => m.value.roles[roleKey.value] ?? roleKey.value)

/** The sites of the person, to switch to: a token is for one site, so the admin signs in again. */
const siteItems = computed<DropdownMenuItem[][]>(() => [
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

const links = computed<NavigationMenuItem[][]>(() => [
  [
    { label: m.value.nav.home, icon: 'i-lucide-house', to: '/', exact: true },
    { label: m.value.nav.entries, icon: 'i-lucide-file-text', to: '/entries' },
    {
      label: m.value.nav.reviews,
      icon: 'i-lucide-inbox',
      to: '/reviews',
      ...(pending.value > 0 ? { badge: String(pending.value) } : {}),
    },
  ],
  [
    { label: m.value.nav.structure, type: 'label' },
    {
      // A trigger with no link of its own: one with both marks a span as expanded, which axe refuses.
      label: m.value.nav.collections,
      icon: 'i-lucide-layers',
      defaultOpen: true,
      children: [
        { label: m.value.nav.allCollections, to: '/collections', exact: true },
        ...collections.value.map((name) => ({ label: name, to: `/collections/${name}` })),
      ],
    },
    { label: m.value.nav.site, icon: 'i-lucide-globe', to: '/site' },
  ],
  [
    { label: m.value.nav.settings, type: 'label' },
    { label: m.value.nav.people, icon: 'i-lucide-users', to: '/people' },
    { label: m.value.nav.tokens, icon: 'i-lucide-key-round', to: '/tokens' },
  ],
])

/**
 * What ⌘K finds: the sections and collections to go to, what to create, the sites to switch to,
 * and content. Published entries come from Hollware's own `search` (full text and meaning, with a
 * snippet), drafts by their title or slug (search sees only what is published), and the reviews
 * that wait; the server's answers are shown as they come, not filtered again.
 */
const searchOpen = ref(false)
const term = ref('')
const searching = ref(false)
type Entry = Output<'list_entries'>['entries'][number]
const found = ref<Output<'search'>['results']>([])
const drafts = ref<Entry[] | null>(null)
const waiting = ref<Output<'list_reviews'>['reviews']>([])

watch(searchOpen, async (open) => {
  if (!open || drafts.value !== null) return
  const lists = await Promise.all(
    collections.value.map((collection) =>
      api.call('list_entries', { collection, status: 'draft', limit: 100 }),
    ),
  )
  drafts.value = lists.flatMap((list) => list.entries)
  waiting.value = (await api.call('list_reviews', { status: 'pending', limit: 50 })).reviews
})

let timer: ReturnType<typeof setTimeout> | undefined
watch(term, (query) => {
  clearTimeout(timer)
  if (query.trim().length < 2) {
    found.value = []
    return
  }
  timer = setTimeout(async () => {
    searching.value = true
    try {
      found.value = (await api.call('search', { query, limit: 8 })).results
    } finally {
      searching.value = false
    }
  }, 250)
})

const searchGroups = computed<CommandPaletteGroup[]>(() => {
  const query = term.value.trim().toLowerCase()
  const matches = (text: string) => query.length >= 2 && text.toLowerCase().includes(query)
  return [
    {
      id: 'published',
      label: m.value.search.published,
      ignoreFilter: true,
      items: found.value.map(({ entry, snippet }) => ({
        label: titleOf(entry),
        suffix: `${entry.collection} · ${entry.locale}`,
        description: snippet.replace(/[[\]]/g, ''),
        icon: 'i-lucide-file-text',
        to: entryPath(entry),
      })),
    },
    {
      id: 'drafts',
      label: m.value.search.drafts,
      ignoreFilter: true,
      items: (drafts.value ?? [])
        .filter((entry) => matches(titleOf(entry)) || matches(entry.slug))
        .slice(0, 8)
        .map((entry) => ({
          label: titleOf(entry),
          suffix: `${entry.collection} · ${entry.locale}`,
          icon: 'i-lucide-file-pen-line',
          to: entryPath(entry),
        })),
    },
    {
      id: 'reviews',
      label: m.value.search.waiting,
      items: waiting.value.map((review) => ({
        label: titleOf(review.entry),
        suffix: m.value.search.askedBy(review.requestedByName ?? review.requestedBy),
        icon: 'i-lucide-inbox',
        to: '/reviews',
      })),
    },
    {
      id: 'go',
      label: m.value.search.goTo,
      items: [
        ...links.value
          .flat()
          .flatMap((item) =>
            item.type === 'label' || item.to === undefined
              ? []
              : [{ label: String(item.label), icon: item.icon, to: item.to }],
          ),
        { label: m.value.nav.collections, icon: 'i-lucide-layers', to: '/collections' },
        ...collections.value.map((name) => ({
          label: m.value.search.collection(name),
          icon: 'i-lucide-layers',
          to: `/collections/${name}`,
        })),
      ],
    },
    {
      id: 'create',
      label: m.value.search.create,
      items: [
        { label: m.value.search.newEntry, icon: 'i-lucide-plus', to: '/entries/new' },
        { label: m.value.search.newCollection, icon: 'i-lucide-plus', to: '/collections' },
        { label: m.value.search.newSite, icon: 'i-lucide-plus', to: '/site' },
        { label: m.value.search.invite, icon: 'i-lucide-user-plus', to: '/people' },
        { label: m.value.search.newToken, icon: 'i-lucide-key-round', to: '/tokens' },
      ],
    },
    {
      id: 'sites',
      label: m.value.search.switchSite,
      items: (me.value?.sites ?? [])
        .filter((membership) => membership.site !== me.value?.site)
        .map((membership) => ({
          label: membership.site,
          suffix: m.value.roles[membership.role] ?? membership.role,
          icon: 'i-lucide-globe',
          onSelect: () => void auth.switchSite(membership.site, '/admin/'),
        })),
    },
  ]
})

const personItems = computed<DropdownMenuItem[][]>(() => [
  [
    {
      label: me.value?.user?.name ?? m.value.person.you,
      description: m.value.person.roleOf(role.value, me.value?.site ?? ''),
      type: 'label',
    },
  ],
  [
    { label: m.value.nav.tokens, icon: 'i-lucide-key-round', to: '/tokens' },
    { label: m.value.nav.people, icon: 'i-lucide-users', to: '/people' },
    {
      label: m.value.person.language,
      icon: 'i-lucide-languages',
      children: [
        LANGUAGES.map(({ locale, name }) => ({
          label: name,
          type: 'checkbox' as const,
          checked: currentLocale.value === locale,
          onSelect: () => setLocale(locale),
        })),
      ],
    },
  ],
])

const initial = computed(() => (me.value?.user?.name ?? '?').trim().charAt(0).toUpperCase())
</script>

<template>
  <UApp :locale="uiLocale">
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
              :aria-label="m.nav.site"
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
              :aria-label="m.person.you"
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

      <UDashboardSearch
        v-model:open="searchOpen"
        v-model:search-term="term"
        :groups="searchGroups"
        :loading="searching"
        :color-mode="false"
        :placeholder="m.search.placeholder"
      />

      <RouterView />
    </UDashboardGroup>
  </UApp>
</template>
