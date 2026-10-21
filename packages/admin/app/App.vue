<script setup lang="ts">
import type { CommandPaletteGroup, DropdownMenuItem, NavigationMenuItem } from '@nuxt/ui'
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { currentLocale, LANGUAGES, setLocale, uiLocale, useMessages } from './i18n/index.ts'
import type { Output } from './lib/api.ts'
import { entryPath, titleOf } from './lib/entries.ts'
import { me, useSiteMenu, type Me } from './lib/me.ts'
import { api, auth } from './lib/session.ts'

/**
 * The shell of the admin, as Linear lays one out with Nuxt UI's dashboard: the site to work in
 * at the top of a sidebar, search on ⌘K, the sections with their icons, and the person at the
 * foot; each page is a panel beside it.
 */

const route = useRoute()
const m = useMessages()
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

const siteItems = useSiteMenu()

const links = computed<NavigationMenuItem[][]>(() => [
  [
    { label: m.value.nav.home, icon: 'i-lucide-house', to: '/', exact: true },
    { label: m.value.nav.entries, icon: 'i-lucide-file-text', to: '/entries' },
    { label: m.value.nav.images, icon: 'i-lucide-image', to: '/images' },
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
    // The log names people and their tokens: only an owner reads it.
    ...(roleKey.value === 'owner'
      ? [{ label: m.value.nav.activity, icon: 'i-lucide-scroll-text', to: '/activity' }]
      : []),
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
    { label: m.value.person.account, icon: 'i-lucide-circle-user', to: '/account' },
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
  [
    {
      label: m.value.person.signOut,
      icon: 'i-lucide-log-out',
      onSelect: () => void auth.signOut(),
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
              :aria-label="`${me?.site ?? 'Hollware'} · ${m.nav.site}`"
            >
              <svg
                viewBox="0 0 204 243"
                class="h-5 w-auto shrink-0 fill-secondary"
                aria-hidden="true"
              >
                <path
                  fill-rule="evenodd"
                  d="M109.3 17.8 C101.9 25.0 98.5 35.8 100.9 44.7 C102.3 49.9 108.5 57.8 114.2 61.7 C139.7 79.0 149.8 88.1 158.8 102.0 C167.7 115.8 173.7 137.1 172.5 150.5 C170.4 172.6 163.0 189.2 148.6 203.6 C137.8 214.3 126.3 221.1 112.9 224.5 C104.2 226.8 104.0 226.4 111.5 221.4 C119.6 216.2 123.8 212.3 128.5 206.0 C133.9 198.6 136.9 189.4 132.7 192.8 C129.7 195.3 117.7 201.0 115.5 201.0 C114.2 201.0 111.7 202.5 109.7 204.5 C105.3 208.9 103.4 208.9 101.6 204.5 C101.1 203.33 100.6 202.17 100.1 201.0 C97.13 201.0 94.17 201.0 91.2 201.0 C88.27 201.0 85.33 201.0 82.4 201.0 C81.83 202.17 81.27 203.33 80.7 204.5 C79.8 206.4 78.5 208.0 77.9 208.0 C77.2 208.0 75.0 206.2 73.0 204.0 C70.9 201.7 68.4 200.0 67.1 200.0 C64.1 200.0 53.0 195.3 50.4 192.9 C47.6 190.3 46.7 190.5 47.5 193.7 C49.8 203.2 61.9 216.2 74.3 222.7 C78.8 225.0 76.1 225.5 69.3 223.5 C44.9 216.4 23.5 195.2 17.6 172.3 C15.6 164.8 15.6 151.3 17.4 144.3 C20.6 132.5 32.0 117.3 42.1 111.4 C45.1 109.7 51.3 106.1 55.9 103.4 C60.4 100.7 65.8 97.0 67.7 95.1 C68.9 93.93 70.1 92.77 71.3 91.6 C71.07 93.2 70.83 94.8 70.6 96.4 C70.2 99.0 68.7 104.1 67.4 107.8 C60.6 125.7 64.4 137.8 78.3 142.5 C82.3 143.8 83.2 143.8 86.6 142.4 C88.8 141.5 92.4 139.0 94.8 136.7 C102.1 129.6 103.7 119.4 100.0 103.5 C97.4 92.6 92.8 83.5 84.6 73.5 C76.5 63.7 74.5 58.3 75.3 49.3 C76.6 35.8 89.3 21.7 105.4 16.0 C113.0 13.3 113.7 13.6 109.3 17.8 Z M137.2 151.8 C131.3 160.9 124.4 166.8 109.2 175.9 C100.9 180.9 100.3 181.5 102.1 183.7 C106.2 188.6 121.0 191.0 129.2 188.1 C138.2 185.1 145.0 174.2 145.0 163.0 C145.0 158.1 142.6 148.5 141.1 147.5 C140.6 147.3 138.8 149.1 137.2 151.8 Z M41.2 155.2 C38.6 162.7 38.5 164.9 40.6 171.9 C43.2 180.8 51.5 188.1 60.8 189.6 C69.1 190.9 81.0 186.3 81.0 181.7 C81.0 181.0 79.3 179.6 77.3 178.6 C68.6 174.5 54.8 163.8 50.4 157.8 C48.0 154.5 46.0 151.2 46.0 150.4 C46.0 149.6 45.4 149.0 44.7 149.0 C44.0 149.0 42.4 151.8 41.2 155.2 Z"
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
              :aria-label="collapsed ? `${me?.user?.name ?? m.person.you} · ${role}` : undefined"
            >
              <UAvatar :text="initial" size="2xs" aria-hidden="true" />
              <span v-if="!collapsed" class="truncate">{{ me?.user?.name ?? m.person.you }}</span>
              <span v-if="!collapsed" class="ms-auto font-mono text-xs text-muted">{{ role }}</span>
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
