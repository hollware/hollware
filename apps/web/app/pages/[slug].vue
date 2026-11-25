<script setup lang="ts">
const route = useRoute()
const slug = computed(() => String(route.params['slug']))
</script>

<template>
  <PageStandalone :key="slug" :slug="slug" />
</template>
