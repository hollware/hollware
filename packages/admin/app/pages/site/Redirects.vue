<script setup lang="ts">
import Page from '../../components/Page.vue'
import { onMounted, ref } from 'vue'
import type { Output } from '../../lib/api.ts'
import { useMessages } from '../../i18n/index.ts'
import { api } from '../../lib/session.ts'

type Redirect = Output<'list_redirects'>['redirects'][number]

const m = useMessages()
const redirects = ref<Redirect[] | null>(null)

onMounted(async () => {
  redirects.value = (await api.call('list_redirects', { limit: 500 })).redirects
})
</script>

<template>
  <Page :title="m.settings.sections.redirects" :description="m.site.redirectsHelp">
    <div class="max-w-2xl">
      <p v-if="redirects === null" class="text-muted">{{ m.common.loading }}</p>
      <p v-else-if="redirects.length === 0" class="text-sm text-muted">{{ m.site.noRedirects }}</p>
      <ul v-else class="divide-y divide-default rounded-lg border border-default text-sm">
        <li
          v-for="redirect in redirects"
          :key="`${redirect.collection}/${redirect.locale}/${redirect.from}`"
          class="flex flex-wrap items-center gap-2 px-3 py-2 font-mono"
        >
          <span>{{ redirect.fromPath ?? redirect.from }}</span>
          <UIcon name="i-lucide-arrow-right" class="text-muted" aria-hidden="true" />
          <span>{{ redirect.toPath ?? redirect.to }}</span>
        </li>
      </ul>
    </div>
  </Page>
</template>
