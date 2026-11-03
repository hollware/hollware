<script setup lang="ts">
defineProps<{ id?: string }>()
</script>

<template>
  <section :id="id" class="scroll-mt-24 py-20 lg:py-28">
    <UContainer>
      <div class="max-w-2xl">
        <p
          v-if="$slots.eyebrow"
          class="font-mono text-xs tracking-[0.18em] text-secondary uppercase"
        >
          <slot name="eyebrow" />
        </p>
        <h2
          v-if="$slots.title"
          class="mt-3 text-3xl font-semibold tracking-[-0.025em] text-balance text-highlighted sm:text-4xl"
        >
          <slot name="title" />
        </h2>
        <div
          v-if="$slots.lead"
          class="mt-4 text-lg leading-relaxed text-pretty text-muted landing-copy"
        >
          <slot name="lead" />
        </div>
      </div>
      <div class="mt-12 landing-copy">
        <slot />
      </div>
    </UContainer>
  </section>
</template>
