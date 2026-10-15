<script setup lang="ts">
// The blog in one locale, newest first: the routes of the playground's config.
const props = defineProps<{ locale: 'es' | 'en' }>()
const prefix = props.locale === 'en' ? '/en' : ''
const { data } = await useHollwareEntries('blog', { locale: props.locale, limit: 20 })
</script>

<template>
  <h1>Blog</h1>
  <p>
    <NuxtLink :to="locale === 'en' ? '/' : '/en/'">{{
      locale === 'en' ? 'Español' : 'English'
    }}</NuxtLink>
  </p>
  <ul>
    <li v-for="entry in data?.entries ?? []" :key="entry.id">
      <NuxtLink :to="`${prefix}/blog/${entry.slug}/`">{{ entry.frontmatter['title'] }}</NuxtLink>
    </li>
  </ul>
</template>
