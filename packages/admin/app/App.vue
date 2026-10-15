<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { api, auth } from './lib/session.ts'

const links = [
  { label: 'Entries', to: '/' },
  { label: 'Reviews', to: '/reviews' },
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
    <div class="min-h-screen">
      <header class="border-b border-default">
        <nav class="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3" aria-label="Main">
          <span class="font-semibold">Hollware</span>
          <RouterLink
            v-for="link in links"
            :key="link.to"
            :to="link.to"
            class="text-sm text-muted hover:text-highlighted"
            active-class="text-highlighted font-medium"
          >
            {{ link.label }}
          </RouterLink>
          <div v-if="me !== null" class="ml-auto flex items-center gap-2 text-sm">
            <USelect
              v-if="choices.length > 1"
              v-model="site"
              :items="choices"
              aria-label="Site"
              class="w-48"
            />
            <span v-else class="text-muted">{{ me.site }}</span>
          </div>
        </nav>
      </header>
      <main class="mx-auto max-w-6xl px-4 py-6">
        <RouterView />
      </main>
    </div>
  </UApp>
</template>
