<script setup lang="ts">
const props = defineProps<{ locale: 'es' | 'en' }>()
const route = useRoute()
const slug = String(route.params['slug'])
const { data, error } = await useHollwareEntry('blog', props.locale, slug)
if (error.value !== undefined && error.value !== null) {
  throw createError({ statusCode: 404, statusMessage: 'Not found', fatal: true })
}
useHead({
  htmlAttrs: { lang: props.locale },
  title: () => String(data.value?.entry?.frontmatter['title'] ?? ''),
})
</script>

<template>
  <article v-if="data?.entry">
    <h1>{{ data.entry.frontmatter['title'] }}</h1>
    <HollwareContent :entry="data.entry" />
  </article>
</template>
