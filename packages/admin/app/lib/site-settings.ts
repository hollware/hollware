import { useToast } from '@nuxt/ui/composables/useToast'
import { onMounted, ref } from 'vue'
import { useMessages } from '../i18n/index.ts'
import type { Output } from './api.ts'
import { api } from './session.ts'
import { useStructureChange } from './structure.ts'

export type Structure = Output<'get_structure'>
export type Definition = Structure['definition']

export function useSiteSettings(onLoad: (structure: Structure) => void = () => {}) {
  const toast = useToast()
  const m = useMessages()
  const structure = ref<Structure | null>(null)

  async function load() {
    const read = await api.call('get_structure', {})
    structure.value = read
    onLoad(read)
  }

  const change = useStructureChange(async (answer) => {
    toast.add({
      title:
        answer.outcome === 'updated' ? m.value.common.savedApplies : m.value.common.nothingChanged,
      color: 'success',
    })
    await load()
  })

  async function save(next: (definition: Definition) => Definition) {
    const current = structure.value
    if (current === null) return
    const definition = next(current.definition)
    await change.run((confirm) =>
      api.call('update_site', { version: current.version, definition, confirm }),
    )
  }

  onMounted(load)
  return { structure, change, load, save }
}
