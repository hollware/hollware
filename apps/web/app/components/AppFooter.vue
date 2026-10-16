<script setup lang="ts">
const { m } = useLocale()
</script>

<template>
  <UFooter class="border-t border-default">
    <template #left>
      <p class="text-sm text-muted">{{ m.footer }}</p>
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
        :aria-label="m.nav.github"
      />
    </template>
  </UFooter>
</template>
