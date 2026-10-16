<script setup lang="ts">
// The docs start at their first page in reading order.
const { locale, m } = useLocale()
const pages = await useDocsPages(locale.value)
const first = pages.value[0]
if (first === undefined)
  throw createError({ statusCode: 404, statusMessage: m.value.docs.empty, fatal: true })
await navigateTo(first.to, { redirectCode: 302 })
</script>

<template>
  <div />
</template>
