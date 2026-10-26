<script setup lang="ts">
import Page from '../../components/Page.vue'
import AnalyticsSettings from '../../components/AnalyticsSettings.vue'
import { useMessages } from '../../i18n/index.ts'

const m = useMessages()
</script>

<template>
  <Page :title="m.settings.sections.analytics" :description="m.analytics.help">
    <AnalyticsSettings />
  </Page>
</template>
