<script setup lang="ts">
const { data } = await useHollwareEntries('blog', { locale: 'en', limit: 20 })
</script>

<template>
  <h1>Blog</h1>
  <ul>
    <li v-for="entry in data?.entries ?? []" :key="entry.id">
      <NuxtLink :to="`/blog/${entry.slug}/`">{{ entry.frontmatter['title'] }}</NuxtLink>
    </li>
  </ul>
</template>
