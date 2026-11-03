<script setup lang="ts">
import type { PageEntry } from '@hollware/nuxt'

const props = defineProps<{ collection: 'features' | 'compare' | 'glossary' }>()
const { locale, m, to } = useLocale()
const page = await usePage('pages', props.collection)
const [own, english] = await Promise.all([
  useHollwareEntries(props.collection, { locale: locale.value, limit: 100 }),
  locale.value === 'en'
    ? Promise.resolve(null)
    : useHollwareEntries(props.collection, { locale: 'en', limit: 100 }),
])
const entries = computed<PageEntry[]>(() => {
  const mine = own.data.value?.entries ?? []
  const slugs = new Set(mine.map((entry) => entry.slug))
  const rest = (english?.data.value?.entries ?? []).filter((entry) => !slugs.has(entry.slug))
  return [...mine, ...rest].sort(
    (a, b) =>
      Number(a.frontmatter['order'] ?? 99) - Number(b.frontmatter['order'] ?? 99) ||
      String(a.frontmatter['title']).localeCompare(String(b.frontmatter['title']), locale.value),
  )
})
const crumbs = computed(() => [
  { name: m.value.pages.home, to: to('/') },
  { name: m.value.pages[props.collection], to: to(`/${props.collection}/`) },
])
const icon = (entry: PageEntry) =>
  typeof entry.frontmatter['icon'] === 'string' ? entry.frontmatter['icon'] : 'file-text'

usePageHead('pages', page, () => [
  breadcrumbs(crumbs.value.map((crumb) => ({ name: crumb.name, path: crumb.to }))),
])
</script>

<template>
  <div>
    <PageArticle
      :entry="page.entry.value"
      :untranslated="page.untranslated.value"
      :crumbs="crumbs"
    />
    <UContainer class="pb-24">
      <p v-if="entries.length === 0" class="text-muted">{{ m.pages.empty }}</p>
      <ul v-else class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <li v-for="entry in entries" :key="entry.id">
          <NuxtLink
            :to="pathOf(collection, entry.slug, locale)"
            class="group flex h-full flex-col gap-3 rounded-xl border border-default bg-elevated/40 p-6 transition-colors hover:border-secondary/50 hover:bg-elevated"
          >
            <UIcon :name="`i-lucide-${icon(entry)}`" class="size-5 text-secondary" />
            <span class="text-lg font-semibold tracking-tight text-highlighted">{{
              entry.frontmatter['title']
            }}</span>
            <span class="text-[15px] leading-relaxed text-muted">{{
              entry.frontmatter['description']
            }}</span>
          </NuxtLink>
        </li>
      </ul>
    </UContainer>
  </div>
</template>
