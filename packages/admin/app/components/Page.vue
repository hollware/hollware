<script setup lang="ts">
import { useMessages } from '../i18n/index.ts'
import { me, useSiteMenu } from '../lib/me.ts'

defineProps<{ title: string; description?: string }>()
const m = useMessages()
const siteMenu = useSiteMenu()
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <UDashboardNavbar :title="title">
        <template #leading>
          <UDashboardSidebarCollapse />
          <UDropdownMenu v-if="me !== null" :items="siteMenu" :content="{ align: 'start' }">
            <UButton
              :label="me.site"
              :aria-label="m.nav.siteOfPage(me.site)"
              icon="i-lucide-globe"
              trailing-icon="i-lucide-chevrons-up-down"
              color="neutral"
              variant="ghost"
              size="sm"
              class="font-mono text-muted"
            />
          </UDropdownMenu>
          <span v-if="me !== null" aria-hidden="true" class="text-dimmed">/</span>
        </template>
        <template #right>
          <slot name="actions" />
        </template>
      </UDashboardNavbar>
    </template>
    <template #body>
      <p v-if="description !== undefined" class="-mt-2 text-sm text-muted">{{ description }}</p>
      <slot />
    </template>
  </UDashboardPanel>
</template>
