<script setup lang="ts">
const props = defineProps<{ name?: string }>()
</script>

<template>
  <span class="text-highlighted">{{ factOf(props.name) }}</span>
</template>
