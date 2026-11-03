<script setup lang="ts">
const props = defineProps<{ collection: 'glossary' }>()
const route = useRoute()
const { locale, m, to } = useLocale()
const slug = computed(() => String(route.params['slug']))
const page = await usePage(props.collection, slug)
const crumbs = computed(() => [
  { name: m.value.pages.home, to: to('/') },
  { name: m.value.pages[props.collection], to: to(`/${props.collection}/`) },
  {
    name: typeof page.front.value['title'] === 'string' ? page.front.value['title'] : slug.value,
    to: pathOf(props.collection, slug.value, locale.value),
  },
])

usePageHead(props.collection, page, (entry) => {
  const front = entry.frontmatter
  const text = (value: unknown) => (typeof value === 'string' ? value : '')
  const path = pathOf(props.collection, entry.slug, locale.value)
  return [
    techArticle({
      title: text(front['title']),
      description: text(front['description']),
      path,
      locale: entry.locale,
      modified: entry.updatedAt,
    }),
    breadcrumbs(crumbs.value.map((crumb) => ({ name: crumb.name, path: crumb.to }))),
    props.collection === 'glossary'
      ? definedTerm({
          term: text(front['term']),
          description: text(front['description']),
          path,
          alternateNames: Array.isArray(front['alternateNames'])
            ? front['alternateNames'].filter((name): name is string => typeof name === 'string')
            : [],
        })
      : null,
    faqPage(faqOf(entry.document)),
  ]
})
</script>

<template>
  <PageArticle :entry="page.entry.value" :untranslated="page.untranslated.value" :crumbs="crumbs" />
</template>
