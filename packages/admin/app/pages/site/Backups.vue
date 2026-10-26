<script setup lang="ts">
import Page from '../../components/Page.vue'
import { useToast } from '@nuxt/ui/composables'
import { onMounted, ref } from 'vue'
import StructureDialogs from '../../components/StructureDialogs.vue'
import { ApiError, type Output } from '../../lib/api.ts'
import { formatNumber, useMessages } from '../../i18n/index.ts'
import { BACKUP_RETENTION_MAX_DAYS, BACKUP_RETENTION_MIN_DAYS } from '@hollware/core'
import { api } from '../../lib/session.ts'
import { useSiteSettings } from '../../lib/site-settings.ts'

const toast = useToast()
const m = useMessages()
const backupsOn = ref(true)
const backupsDays = ref<number | undefined>(30)
const backupsError = ref<string | null>(null)
const backupList = ref<Output<'list_backups'> | null>(null)

const { structure, change, load, save } = useSiteSettings((read) => {
  backupsOn.value = read.definition.backups.enabled
  backupsDays.value = read.definition.backups.retentionDays
  backupsError.value = null
})

onMounted(async () => {
  backupList.value = await api.call('list_backups', {})
})

async function saveBackups() {
  const days = backupsDays.value
  if (
    typeof days !== 'number' ||
    !Number.isInteger(days) ||
    days < BACKUP_RETENTION_MIN_DAYS ||
    days > BACKUP_RETENTION_MAX_DAYS
  ) {
    backupsError.value = m.value.site.backupsKeepInvalid(
      BACKUP_RETENTION_MIN_DAYS,
      BACKUP_RETENTION_MAX_DAYS,
    )
    return
  }
  backupsError.value = null
  await save((definition) => ({
    ...definition,
    backups: { enabled: backupsOn.value, retentionDays: days },
  }))
}

async function downloadBackup(date: string) {
  try {
    const blob = await api.backup(date)
    const href = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = href
    link.download = `${structure.value?.site ?? 'site'}-${date}.json`
    document.body.append(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(href)
  } catch (error) {
    toast.add({
      title: m.value.site.notDownloaded,
      description: error instanceof ApiError ? `${error.message} ${error.fix}` : String(error),
      color: 'error',
    })
  }
}
</script>

<template>
  <Page :title="m.settings.sections.backups" :description="m.site.backupsHelp">
    <div v-if="structure !== null && backupList !== null" class="max-w-2xl space-y-4">
      <StructureDialogs
        :impact="change.impact.value"
        :problems="change.problems.value"
        :conflict="change.conflict.value"
        :failure="change.failure.value"
        @confirm="change.confirmPending"
        @cancel="change.cancel"
        @reload="load"
      />
      <p v-if="backupList.outcome === 'unavailable'" class="text-sm text-muted">
        {{ m.site.backupsUnavailable }}
      </p>
      <template v-else>
        <form class="space-y-4" novalidate @submit.prevent="saveBackups">
          <USwitch v-model="backupsOn" :label="m.site.backupsOn" />
          <UFormField
            v-if="backupsOn"
            :label="m.site.backupsKeep"
            :help="m.site.backupsKeepHelp"
            :error="backupsError ?? undefined"
          >
            <UInput
              v-model.number="backupsDays"
              type="number"
              :min="BACKUP_RETENTION_MIN_DAYS"
              :max="BACKUP_RETENTION_MAX_DAYS"
              class="w-40"
            />
          </UFormField>
          <UButton type="submit" :label="m.site.saveBackups" :loading="change.busy.value" />
        </form>
        <p v-if="(backupList.backups ?? []).length === 0" class="text-sm text-muted">
          {{ m.site.noBackups }}
        </p>
        <ul v-else class="divide-y divide-default rounded-lg border border-default text-sm">
          <li
            v-for="backup in backupList.backups ?? []"
            :key="backup.date"
            class="flex items-center justify-between gap-2 px-3 py-2"
          >
            <span class="font-mono tabular-nums">{{ backup.date }}</span>
            <span class="text-muted tabular-nums">{{
              m.site.kilobytes(formatNumber(Math.ceil(backup.bytes / 1024)))
            }}</span>
            <UButton
              :label="m.site.download"
              :aria-label="m.site.downloadOne(backup.date)"
              icon="i-lucide-download"
              size="xs"
              variant="ghost"
              @click="downloadBackup(backup.date)"
            />
          </li>
        </ul>
      </template>
    </div>
    <p v-else class="text-muted">{{ m.common.loading }}</p>
  </Page>
</template>
