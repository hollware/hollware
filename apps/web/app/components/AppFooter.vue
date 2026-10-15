<template>
  <UFooter class="border-t border-default">
    <template #left>
      <p class="text-sm text-muted">
        Hollware is open source, MIT. Made for agents, kept by people.
      </p>
    </template>
    <template #right>
      <UButton
        to="/llms.txt"
        label="llms.txt"
        color="neutral"
        variant="ghost"
        size="sm"
        class="font-mono"
      />
      <UButton
        to="https://github.com/hollware/hollware"
        target="_blank"
        icon="i-lucide-github"
        color="neutral"
        variant="ghost"
        aria-label="Hollware on GitHub"
      />
    </template>
  </UFooter>
</template>
