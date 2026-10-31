import { useToast } from '@nuxt/ui/composables/useToast'
import { useQuery } from '@pinia/colada'
import { computed, watch } from 'vue'
import { useMessages } from '../i18n/index.ts'
import type { Output } from './api.ts'
import { operation } from './queries.ts'
import { api } from './session.ts'
import { useStructureChange } from './structure.ts'

export type Structure = Output<'get_structure'>
export type Definition = Structure['definition']

export interface SettingsForm {
  readonly fill: (structure: Structure) => void
  readonly values: () => unknown
}

const NO_FORM: SettingsForm = { fill: () => {}, values: () => null }

export function useSiteSettings(form: SettingsForm = NO_FORM) {
  const toast = useToast()
  const m = useMessages()
  const query = useQuery(operation('get_structure', {}))
  const structure = computed(() => query.data.value ?? null)
  let filled: string | null = null
  let version: number | null = null

  const snapshot = () => JSON.stringify(form.values())
  function fill(read: Structure) {
    form.fill(read)
    filled = snapshot()
    version = read.version
  }

  watch(
    () => query.data.value,
    (read) => {
      if (read !== undefined && (filled === null || snapshot() === filled)) fill(read)
    },
    { immediate: true },
  )

  async function load() {
    const read = await query.refetch()
    if (read.data !== undefined) fill(read.data)
  }

  const change = useStructureChange(async (answer) => {
    toast.add({
      title:
        answer.outcome === 'updated' ? m.value.common.savedApplies : m.value.common.nothingChanged,
      color: 'success',
    })
    filled = snapshot()
    await query.refresh()
  })

  async function save(next: (definition: Definition) => Definition) {
    const current = structure.value
    const base = version
    if (current === null || base === null) return
    const definition = next(current.definition)
    await change.run((confirm) => api.call('update_site', { version: base, definition, confirm }))
  }

  return { structure, change, load, save }
}
