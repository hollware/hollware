<script setup lang="ts">
defineProps<{ icon?: string }>()
</script>

<template>
  <article class="flex min-w-0 flex-col gap-4 bg-default p-7 lg:p-9">
    <UIcon :name="`i-lucide-${icon ?? 'shield-check'}`" class="size-5 text-secondary" />
    <h3 class="text-lg font-semibold tracking-tight text-balance text-highlighted">
      <slot name="problem" />
    </h3>
    <div class="text-[15px] leading-relaxed text-muted landing-copy">
      <slot name="solution" />
    </div>
    <div v-if="$slots.example" class="mt-auto landing-code">
      <slot name="example" />
    </div>
  </article>
</template>
