<script setup lang="ts">
defineProps<{ icon?: string }>()
</script>

<template>
  <div
    class="page-card group relative flex flex-col gap-3 rounded-xl border border-default bg-elevated/40 p-6 transition-colors focus-within:border-secondary/60 hover:border-secondary/50 hover:bg-elevated"
  >
    <UIcon :name="`i-lucide-${icon ?? 'file-text'}`" class="size-5 text-secondary" />
    <div class="text-[15px] leading-relaxed text-muted landing-copy">
      <slot />
    </div>
    <UIcon
      name="i-lucide-arrow-right"
      class="mt-auto size-4 text-dimmed transition-transform group-hover:translate-x-1 group-hover:text-secondary"
    />
  </div>
</template>
