<script setup lang="ts">
const route = useRoute()
const { data: page, error } = await useHollwarePage(route.path)
if (error.value !== undefined && error.value !== null) {
  throw createError({ statusCode: 404, statusMessage: 'Not found', fatal: true })
}
if (page.value?.outcome === 'redirect') {
  await navigateTo(page.value.path, { redirectCode: 301 })
}
const { data: navigation } = await useHollwareNavigation('help', { locale: 'es' })
const entry = computed(() => (page.value?.outcome === 'ok' ? page.value.entry : undefined))
const ancestors = computed(() => (page.value?.outcome === 'ok' ? page.value.ancestors : []))
const title = computed(() => String(entry.value?.frontmatter['title'] ?? entry.value?.slug ?? ''))
useHead({ htmlAttrs: { lang: 'es' }, title })
</script>

<template>
  <div v-if="entry" class="help">
    <nav aria-label="Help">
      <section v-for="group in navigation?.groups ?? []" :key="group.name ?? ''">
        <HelpTree :entries="group.entries" :current="entry.slug" />
      </section>
    </nav>
    <article>
      <nav aria-label="Breadcrumbs">
        <ol>
          <li v-for="ancestor in ancestors" :key="ancestor.slug">
            <NuxtLink :to="ancestor.path ?? ''">{{ ancestor.title }}</NuxtLink>
          </li>
          <li>
            <span aria-current="page">{{ title }}</span>
          </li>
        </ol>
      </nav>
      <h1>{{ title }}</h1>
      <HollwareContent :entry="entry" />
    </article>
  </div>
</template>
