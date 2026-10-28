<script setup lang="ts">
import { computed } from 'vue'
import { type RouteLocationRaw, useRoute } from 'vue-router'
import { useMessages } from '../i18n/index.ts'
import { me, useSiteMenu } from '../lib/me.ts'
import { usePageTitle } from '../lib/title.ts'

const props = defineProps<{
  title: string
  description?: string
  crumbs?: readonly { readonly label: string; readonly to?: RouteLocationRaw }[]
  flush?: boolean
}>()
const m = useMessages()
const route = useRoute()
const siteMenu = useSiteMenu()
usePageTitle(() => props.title)

const inSettings = computed(() => route.path.startsWith('/settings'))
const trail = computed(
  () =>
    props.crumbs ?? (inSettings.value ? [{ label: m.value.nav.settings, to: '/settings' }] : []),
)
</script>

<template>
  <UDashboardPanel
    id="main"
    role="main"
    tabindex="-1"
    class="focus:outline-none"
    :ui="flush ? { body: 'p-0 sm:p-0 gap-0' } : undefined"
  >
    <template #header>
      <UDashboardNavbar :title="title" :ui="{ title: 'text-sm font-medium truncate' }">
        <template #leading>
          <UDashboardSidebarCollapse />
          <nav
            :aria-label="m.nav.breadcrumb"
            class="flex min-w-0 items-center gap-1 text-sm text-muted"
          >
            <UDropdownMenu v-if="me !== null" :items="siteMenu" :content="{ align: 'start' }">
              <UButton
                :label="me.site"
                :aria-label="m.nav.siteOfPage(me.site)"
                color="neutral"
                variant="ghost"
                size="xs"
                class="font-mono text-muted"
              />
            </UDropdownMenu>
            <template v-for="crumb in trail" :key="crumb.label">
              <UIcon name="i-lucide-chevron-right" class="size-3.5 shrink-0 text-dimmed" />
              <ULink
                v-if="crumb.to !== undefined"
                :to="crumb.to"
                class="truncate hover:text-highlighted"
                >{{ crumb.label }}</ULink
              >
              <span v-else class="truncate">{{ crumb.label }}</span>
            </template>
            <UIcon name="i-lucide-chevron-right" class="size-3.5 shrink-0 text-dimmed" />
          </nav>
        </template>
        <template #right>
          <slot name="actions" />
        </template>
      </UDashboardNavbar>
      <UDashboardToolbar v-if="$slots.toolbar" :ui="{ root: 'gap-2 overflow-x-auto' }">
        <slot name="toolbar" />
      </UDashboardToolbar>
    </template>
    <template #body>
      <p v-if="description !== undefined" class="-mt-2 text-sm text-muted">{{ description }}</p>
      <slot />
    </template>
  </UDashboardPanel>
</template>
