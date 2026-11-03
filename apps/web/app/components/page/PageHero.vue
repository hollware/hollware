<template>
  <section class="relative isolate overflow-hidden border-b border-default">
    <ShaderBackdrop variant="hero" />
    <UContainer
      class="grid items-center gap-14 py-20 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:py-28"
    >
      <div class="min-w-0">
        <p class="font-mono text-xs tracking-[0.18em] text-secondary uppercase">
          <slot name="eyebrow" />
        </p>
        <h1
          class="mt-5 text-5xl font-semibold tracking-[-0.035em] text-balance text-highlighted sm:text-6xl lg:text-[4.25rem] lg:leading-[1.02]"
        >
          <slot name="title" />
        </h1>
        <div class="mt-6 max-w-xl text-lg leading-relaxed text-pretty text-muted landing-copy">
          <slot name="lead" />
        </div>
        <div class="mt-9">
          <slot />
        </div>
      </div>
      <div class="min-w-0">
        <slot name="session" />
      </div>
    </UContainer>
  </section>
</template>
