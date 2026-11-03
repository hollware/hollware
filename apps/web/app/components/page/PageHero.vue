<script setup lang="ts">
provide('install-compact', true)
</script>

<template>
  <section data-landing="hero" class="relative isolate overflow-hidden border-b border-default">
    <div class="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[36rem] backdrop-glow" />
    <UContainer
      class="grid items-center gap-10 py-20 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:py-28"
    >
      <div class="min-w-0">
        <p
          v-if="$slots.eyebrow"
          class="font-mono text-xs tracking-[0.18em] text-secondary uppercase"
        >
          <slot name="eyebrow" />
        </p>
        <h1
          class="mt-5 text-5xl font-semibold tracking-[-0.035em] text-balance text-highlighted sm:text-6xl lg:text-[4.5rem] lg:leading-[1.02]"
        >
          <slot name="title" />
        </h1>
        <div class="mt-6 max-w-lg text-lg leading-relaxed text-pretty text-muted landing-copy">
          <slot name="lead" />
        </div>
        <div class="mt-9">
          <slot />
        </div>
      </div>
      <EmbersSlot
        name="hero"
        class="order-first max-w-[13rem] sm:max-w-[20rem] lg:order-none lg:max-w-[28rem]"
      />
    </UContainer>
  </section>
</template>
