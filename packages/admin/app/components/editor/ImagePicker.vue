<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useMessages } from '../../i18n/index.ts'
import type { Output } from '../../lib/api.ts'
import { api } from '../../lib/session.ts'

type Asset = Output<'list_assets'>['assets'][number]

const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ pick: [image: { src: string; alt: string }] }>()
const m = useMessages()
const assets = ref<Asset[] | null>(null)
const url = ref('')
const alt = ref('')
const tab = ref('library')

watch(open, async (isOpen) => {
  if (!isOpen) return
  url.value = ''
  alt.value = ''
  if (assets.value === null) assets.value = (await api.call('list_assets', { limit: 100 })).assets
})

const tabs = computed(() => [
  { label: m.value.editor.image.library, value: 'library', slot: 'library' as const },
  { label: m.value.editor.image.url, value: 'url', slot: 'url' as const },
])

function pick(src: string, text: string) {
  emit('pick', { src, alt: text })
  open.value = false
}
</script>

<template>
  <UModal v-model:open="open" :title="m.editor.image.title" :ui="{ content: 'max-w-2xl' }">
    <template #body>
      <UTabs v-model="tab" :items="tabs" variant="link">
        <template #library>
          <p v-if="assets !== null && assets.length === 0" class="pt-4 text-sm text-muted">
            {{ m.editor.image.empty }}
          </p>
          <ul v-else class="grid grid-cols-3 gap-3 pt-4">
            <li v-for="asset in assets ?? []" :key="asset.id">
              <button
                type="button"
                class="block w-full overflow-hidden rounded-md border border-default text-left hover:ring-2 hover:ring-secondary/60 focus-visible:ring-2 focus-visible:ring-secondary focus-visible:outline-none"
                :aria-label="m.editor.image.insertNamed(asset.alt || asset.reference)"
                @click="pick(asset.reference, asset.alt)"
              >
                <img :src="asset.url" :alt="asset.alt" class="aspect-video w-full object-cover" />
                <span class="block truncate px-2 py-1 text-xs text-muted">{{
                  asset.alt || asset.reference
                }}</span>
              </button>
            </li>
          </ul>
        </template>
        <template #url>
          <form class="space-y-3 pt-4" @submit.prevent="pick(url.trim(), alt.trim())">
            <UFormField :label="m.editor.image.address">
              <UInput
                v-model="url"
                type="url"
                class="w-full"
                :placeholder="m.editor.image.addressPlaceholder"
              />
            </UFormField>
            <UFormField :label="m.editor.image.alt">
              <UInput v-model="alt" class="w-full" />
            </UFormField>
            <UButton type="submit" :label="m.editor.image.insert" :disabled="url.trim() === ''" />
          </form>
        </template>
      </UTabs>
    </template>
  </UModal>
</template>
