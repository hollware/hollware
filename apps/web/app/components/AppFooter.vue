<script setup lang="ts">
const { m } = useLocale()
</script>

<template>
  <UFooter class="border-t border-default">
    <template #left>
      <p class="text-sm text-muted">
        {{ m.footer.license }} · {{ m.footer.by }}
        <a
          href="https://sergioazocar.com"
          class="text-highlighted underline decoration-(--ui-border-accented) underline-offset-4 hover:decoration-current"
          >{{ m.footer.author }}</a
        >
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
        :aria-label="m.nav.github"
      />
    </template>
  </UFooter>
</template>
