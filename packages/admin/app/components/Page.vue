<script setup lang="ts">
/**
 * A page of the admin: a panel of Nuxt UI's dashboard beside the sidebar, its title and its
 * actions in the bar at the top, its content below, as Linear lays out a view.
 */
defineProps<{ title: string; description?: string }>()
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <UDashboardNavbar :title="title">
        <template #leading>
          <UDashboardSidebarCollapse />
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
