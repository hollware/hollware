<script setup lang="ts">
defineProps<{ name: 'hero' | 'cta' }>()
const live = useState('embers-live', () => false)
</script>

<template>
  <div :data-ember-slot="name" class="relative mx-auto aspect-[430/512] w-full" aria-hidden="true">
    <img
      src="/brand/hollware-mark.svg"
      alt=""
      class="embers-still absolute inset-[10%] size-[80%] transition-opacity duration-700"
      :class="live ? 'opacity-0' : 'opacity-100'"
    />
  </div>
</template>
