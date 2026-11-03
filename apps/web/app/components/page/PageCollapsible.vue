<template>
  <details class="page-collapsible not-prose my-8 rounded-xl border border-default">
    <summary
      class="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-sm font-medium text-highlighted"
    >
      <slot name="summary" />
      <UIcon name="i-lucide-chevron-down" class="page-collapsible-icon size-4 text-dimmed" />
    </summary>
    <div class="border-t border-default px-5 py-4 text-sm text-muted landing-copy">
      <slot />
    </div>
  </details>
</template>
