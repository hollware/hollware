<template>
  <section class="relative isolate overflow-hidden border-t border-default py-28 lg:py-36">
    <div class="pointer-events-none absolute inset-x-0 top-0 -z-10 h-full backdrop-glow" />
    <UContainer class="flex flex-col items-center text-center">
      <h2
        class="max-w-3xl text-4xl font-semibold tracking-[-0.03em] text-balance text-highlighted sm:text-5xl"
      >
        <slot name="title" />
      </h2>
      <div class="mt-10 flex w-full justify-center text-left">
        <slot />
      </div>
    </UContainer>
  </section>
</template>
