<template>
  <section class="relative py-16">
    <UContainer class="grid items-center gap-6 lg:grid-cols-[1fr_auto_1fr]">
      <div class="landing-code chaos-before min-w-0">
        <slot name="before" />
      </div>
      <UIcon
        name="i-lucide-arrow-right"
        class="mx-auto size-6 rotate-90 text-secondary lg:rotate-0"
      />
      <div class="landing-code chaos-after min-w-0">
        <slot name="after" />
      </div>
    </UContainer>
  </section>
</template>
