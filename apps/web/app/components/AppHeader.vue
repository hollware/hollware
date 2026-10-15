<script setup lang="ts">
const route = useRoute()
// On a page of the docs, the menu of a small screen holds their sidebar too.
const { data } = useHollwareEntries('docs', { locale: 'en', limit: 100 }, { lazy: true })
const pages = computed(() => readingOrder(data.value?.entries ?? []))

const links = [
  { label: 'Docs', to: '/docs/', icon: 'i-lucide-book-open' },
  { label: 'Tools', to: '/reference/mcp-tools/', icon: 'i-lucide-wrench' },
  { label: 'Demo', to: 'https://demo.hollware.com', target: '_blank', icon: 'i-lucide-globe' },
]
</script>

<template>
  <UHeader :to="'/'" title="Hollware" class="backdrop-blur-md bg-default/70">
    <template #title>
      <AppLogo />
    </template>

    <UNavigationMenu :items="links" variant="link" :ui="{ linkLeadingIcon: 'hidden' }" />

    <template #right>
      <UColorModeButton color="neutral" variant="ghost" />
      <UButton
        to="https://github.com/hollware/hollware"
        target="_blank"
        icon="i-lucide-github"
        color="neutral"
        variant="ghost"
        aria-label="Hollware on GitHub"
      />
    </template>

    <template #body>
      <UNavigationMenu :items="links" orientation="vertical" class="-mx-2.5" />
      <template v-if="route.path.startsWith('/docs') || route.path.startsWith('/reference')">
        <USeparator class="my-5" />
        <DocsSidebar :pages="pages" />
      </template>
    </template>
  </UHeader>
</template>
