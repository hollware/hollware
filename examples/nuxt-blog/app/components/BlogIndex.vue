<script setup lang="ts">
const props = defineProps<{ locale: 'es' | 'en' }>()
const prefix = props.locale === 'en' ? '/en' : ''
const { data } = await useHollwareEntries('blog', { locale: props.locale, limit: 20 })
const words = {
  en: {
    title: 'Blog · Hollware demo',
    intro:
      'This blog is a Nuxt site that reads Hollware over a service binding. Agents write its posts over MCP, contracts check every write, and a person approves what goes live.',
  },
  es: {
    title: 'Blog · demo de Hollware',
    intro:
      'Este blog es un sitio Nuxt que lee Hollware a través de un service binding. Los agentes escriben sus entradas por MCP, los contratos revisan cada escritura y una persona aprueba lo que se publica.',
  },
}[props.locale]
useHead({
  htmlAttrs: { lang: props.locale },
  title: words.title,
  meta: [{ name: 'description', content: words.intro }],
})
</script>

<template>
  <h1>Blog</h1>
  <p class="intro">{{ words.intro }}</p>
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
