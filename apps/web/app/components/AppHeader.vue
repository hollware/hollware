<script setup lang="ts">
const route = useRoute()
const { locale, m, to } = useLocale()
const { data } = useHollwareNavigation('docs', () => ({ locale: locale.value }), { lazy: true })
const { data: english } = useHollwareNavigation('docs', { locale: 'en' }, { lazy: true })
const pages = computed(() =>
  docLinks(data.value, locale.value, locale.value === 'en' ? null : (english.value ?? null)),
)

const links = computed(() => [
  { label: m.value.nav.docs, to: to('/docs/'), icon: 'i-lucide-book-open' },
  { label: m.value.nav.tools, to: to('/reference/mcp-tools/'), icon: 'i-lucide-wrench' },
  {
    label: m.value.nav.demo,
    to: 'https://demo.hollware.com',
    target: '_blank',
    icon: 'i-lucide-globe',
  },
])

const other = computed(() => pathIn(locale.value === 'en' ? 'es' : 'en', basePath(route.path)))
const inDocs = computed(() => /^\/(es\/)?(docs|reference)/.test(route.path))
</script>

<template>
  <UHeader :to="to('/')" title="Hollware" class="backdrop-blur-md bg-default/70">
    <template #title>
      <AppLogo />
    </template>

    <UNavigationMenu :items="links" variant="link" :ui="{ linkLeadingIcon: 'hidden' }" />

    <template #right>
      <UButton
        :to="other"
        :label="m.language.switchTo"
        :aria-label="m.language.switch"
        :hreflang="locale === 'en' ? 'es' : 'en'"
        icon="i-lucide-languages"
        color="neutral"
        variant="ghost"
      />
      <UButton
        to="https://github.com/hollware/hollware"
        target="_blank"
        icon="i-lucide-github"
        color="neutral"
        variant="ghost"
        :aria-label="m.nav.github"
      />
    </template>

    <template #body>
      <UNavigationMenu :items="links" orientation="vertical" class="-mx-2.5" />
      <template v-if="inDocs">
        <USeparator class="my-5" />
        <DocsSidebar :pages="pages" />
      </template>
    </template>
  </UHeader>
</template>
