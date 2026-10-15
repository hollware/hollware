<script setup lang="ts">
const links = [
  { label: 'Entries', to: '/' },
  { label: 'Reviews', to: '/reviews' },
  { label: 'Tokens', to: '/tokens' },
  { label: 'People', to: '/people' },
]
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
        </nav>
      </header>
      <main class="mx-auto max-w-6xl px-4 py-6">
        <RouterView />
      </main>
    </div>
  </UApp>
</template>
