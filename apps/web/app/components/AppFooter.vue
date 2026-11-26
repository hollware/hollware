<script setup lang="ts">
const { m } = useLocale()
const settings = await useSettings()
</script>

<template>
  <UFooter class="border-t border-default">
    <template #left>
      <p class="text-sm text-muted">{{ settings.footer.tagline }}</p>
    </template>
    <template #right>
      <UButton
        v-for="link in settings.footer.links"
        :key="link.href"
        :to="link.href"
        :target="isExternal(link.href) ? '_blank' : undefined"
        :label="link.label"
        color="neutral"
        variant="ghost"
        size="sm"
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
