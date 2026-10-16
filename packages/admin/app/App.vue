<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { api, auth } from './lib/session.ts'

const links = [
  { label: 'Home', to: '/' },
  { label: 'Entries', to: '/entries' },
  { label: 'Reviews', to: '/reviews' },
  { label: 'Collections', to: '/collections' },
  { label: 'Site', to: '/site' },
  { label: 'Tokens', to: '/tokens' },
  { label: 'People', to: '/people' },
]

/** What `/v1/admin/me` says: the person, the site of the token and the sites they may switch to. */
interface Me {
  readonly user: { readonly id: string; readonly name: string | null } | undefined
  readonly site: string
  readonly sites: readonly { readonly site: string; readonly role: string }[]
}

const route = useRoute()
const me = ref<Me | null>(null)

// Once a page that needs a token is reached, never on the callback, which has none yet.
watch(
  () => route.matched.length > 0 && route.meta['open'] !== true,
  async (signed) => {
    if (!signed || me.value !== null) return
    me.value = await api.admin<Me>('me')
  },
  { immediate: true },
)

const site = computed({
  get: () => me.value?.site,
  set: (next) => {
    if (next === undefined || next === me.value?.site) return
    // A token is for one site: the admin signs in again for the other one.
    void auth.switchSite(next, '/admin/')
  },
})
const choices = computed(() =>
  (me.value?.sites ?? []).map((membership) => ({
    label: `${membership.site} (${membership.role})`,
    value: membership.site,
  })),
)
</script>

<template>
  <UApp>
    <div class="min-h-screen bg-default">
      <header class="sticky top-0 z-10 border-b border-default bg-default/80 backdrop-blur-md">
        <nav
          class="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3"
          aria-label="Main"
        >
          <RouterLink to="/" class="inline-flex items-center gap-2.5">
            <svg viewBox="0 0 32 32" class="size-6" aria-hidden="true">
              <rect width="32" height="32" rx="8" class="fill-(--ui-bg-accented)" />
              <path
                d="M9 8v16M23 8v16M9 16h14"
                class="stroke-primary"
                stroke-width="3"
                stroke-linecap="round"
                fill="none"
              />
            </svg>
            <span class="font-semibold tracking-tight text-highlighted">Hollware</span>
            <span
              class="rounded-full border border-default px-2 py-0.5 font-mono text-[11px] text-muted"
              >admin</span
            >
          </RouterLink>
          <RouterLink
            v-for="link in links"
            :key="link.to"
            :to="link.to"
            class="text-sm text-muted transition-colors hover:text-highlighted"
            :active-class="link.to === '/' ? '' : 'text-highlighted font-medium'"
            exact-active-class="text-highlighted font-medium"
          >
            {{ link.label }}
          </RouterLink>
          <div class="ml-auto flex items-center gap-2 text-sm">
            <template v-if="me !== null">
              <USelect
                v-if="choices.length > 1"
                v-model="site"
                :items="choices"
                aria-label="Site"
                class="w-48"
              />
              <span v-else class="font-mono text-xs text-muted">{{ me.site }}</span>
            </template>
          </div>
        </nav>
      </header>
      <main class="mx-auto max-w-6xl px-4 py-8">
        <RouterView />
      </main>
    </div>
  </UApp>
</template>
