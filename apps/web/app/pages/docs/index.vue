<script setup lang="ts">
// The docs start at their first page in reading order.
const pages = await useDocsPages()
const first = pages.value[0]
if (first === undefined)
  throw createError({ statusCode: 404, statusMessage: 'No docs yet', fatal: true })
await navigateTo(first.to, { redirectCode: 302 })
</script>

<template>
  <div />
</template>
