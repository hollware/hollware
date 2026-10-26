<script setup lang="ts">
import Page from '../../components/Page.vue'
import { useToast } from '@nuxt/ui/composables'
import { onMounted, ref } from 'vue'
import { ApiError } from '../../lib/api.ts'
import { useMessages } from '../../i18n/index.ts'
import { api, auth } from '../../lib/session.ts'

interface Me {
  readonly site: string
  readonly sites: readonly { readonly site: string; readonly role: string }[]
}

const toast = useToast()
const m = useMessages()
const me = ref<Me | null>(null)
const deleteOpen = ref(false)
const deleteEntries = ref<number | null>(null)

async function load() {
  me.value = await api.admin<Me>('me')
}
onMounted(load)

function describe(error: unknown): string {
  return error instanceof ApiError ? `${error.message} ${error.fix}` : String(error)
}

async function askDelete() {
  const site = me.value?.site
  if (site === undefined) return
  const answer = await api.call('delete_site', { key: site, confirm: false })
  deleteEntries.value = answer.entries ?? 0
  deleteOpen.value = true
}

async function deleteSite() {
  const current = me.value
  if (current === null) return
  deleteOpen.value = false
  try {
    await api.call('delete_site', { key: current.site, confirm: true })
    const other = current.sites.find((membership) => membership.site !== current.site)
    toast.add({ title: m.value.site.trashed(current.site), color: 'success' })
    await auth.switchSite(other?.site ?? current.site, '/admin/')
  } catch (error) {
    toast.add({ title: m.value.site.notDeleted, description: describe(error), color: 'error' })
  }
}
</script>

<template>
  <Page :title="m.settings.sections.danger">
    <div v-if="me !== null" class="max-w-2xl">
      <section aria-labelledby="danger" class="space-y-3 rounded-lg border border-error/40 p-4">
        <h2 id="danger" class="font-semibold">{{ m.site.dangerTitle }}</h2>
        <p class="text-sm text-muted">{{ m.site.dangerBody }}</p>
        <UButton :label="m.site.trashIt" color="error" variant="outline" @click="askDelete" />
      </section>
      <UModal v-model:open="deleteOpen" :title="m.site.trashTitle(me.site)">
        <template #body>
          <p>{{ m.site.trashBody(deleteEntries ?? 0) }}</p>
        </template>
        <template #footer>
          <UButton :label="m.common.keepIt" variant="ghost" @click="deleteOpen = false" />
          <UButton :label="m.site.trashIt" color="error" @click="deleteSite" />
        </template>
      </UModal>
    </div>
    <p v-else class="text-muted">{{ m.common.loading }}</p>
  </Page>
</template>
