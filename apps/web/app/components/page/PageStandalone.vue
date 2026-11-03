<script setup lang="ts">
const props = defineProps<{ slug: 'install' | 'media-kit' }>()
const { locale, m, to } = useLocale()
const page = await usePage('pages', props.slug)
const crumbs = computed(() => [
  { name: m.value.pages.home, to: to('/') },
  {
    name: typeof page.front.value['title'] === 'string' ? page.front.value['title'] : props.slug,
    to: pathOf('pages', props.slug, locale.value),
  },
])

usePageHead('pages', page, (entry) => [
  techArticle({
    title: typeof entry.frontmatter['title'] === 'string' ? entry.frontmatter['title'] : '',
    description:
      typeof entry.frontmatter['description'] === 'string' ? entry.frontmatter['description'] : '',
    path: pathOf('pages', entry.slug, locale.value),
    locale: entry.locale,
    modified: entry.updatedAt,
  }),
  breadcrumbs(crumbs.value.map((crumb) => ({ name: crumb.name, path: crumb.to }))),
])
</script>

<template>
  <PageArticle :entry="page.entry.value" :untranslated="page.untranslated.value" :crumbs="crumbs" />
</template>
