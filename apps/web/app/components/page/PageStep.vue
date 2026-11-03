<script setup lang="ts">
defineProps<{ tool?: string }>()
</script>

<template>
  <li class="page-step relative border-t border-default pt-6">
    <code class="font-mono text-sm text-secondary">{{ tool }}</code>
    <div class="mt-3 text-[15px] leading-relaxed text-muted landing-copy">
      <slot />
    </div>
  </li>
</template>
