<script setup lang="ts">
import { useToast } from '@nuxt/ui/composables'
import { onMounted, ref } from 'vue'
import Page from '../components/Page.vue'
import { formatDate, useMessages } from '../i18n/index.ts'
import { ApiError, type Output } from '../lib/api.ts'
import { base64OfFile, sizeOf } from '../lib/images.ts'
import { api } from '../lib/session.ts'

/*
 * The images of the site (ADR-038): upload one with what it shows, see them newest first, and
 * copy the reference that shows one in an entry.
 */

type Asset = NonNullable<Output<'get_asset'>['asset']>

const m = useMessages()
const toast = useToast()
const assets = ref<Asset[]>([])
const next = ref<string | null>(null)
const failure = ref<string | null>(null)
const file = ref<File | null>(null)
const alt = ref('')
const busy = ref(false)
const input = ref<HTMLInputElement | null>(null)

function describe(error: unknown): string {
  return error instanceof ApiError ? `${error.message} ${error.fix}` : String(error)
}

async function load(cursor?: string) {
  try {
    const answer = await api.call('list_assets', {
      limit: 24,
      ...(cursor === undefined ? {} : { cursor }),
    })
    assets.value = cursor === undefined ? answer.assets : [...assets.value, ...answer.assets]
    next.value = answer.nextCursor
    failure.value = null
  } catch (error) {
    failure.value = describe(error)
  }
}

function choose(event: Event) {
  const target = event.target
  file.value = target instanceof HTMLInputElement ? (target.files?.[0] ?? null) : null
}

async function upload() {
  if (file.value === null || alt.value.trim() === '') return
  busy.value = true
  try {
    const answer = await api.call('upload_asset', {
      filename: file.value.name,
      alt: alt.value.trim(),
      data: await base64OfFile(file.value),
    })
    if (answer.asset === undefined) {
      toast.add({
        title: m.value.images.refused,
        description: `${answer.problem?.message ?? ''} ${answer.problem?.fix ?? ''}`.trim(),
        color: 'error',
      })
      return
    }
    toast.add({
      title: answer.outcome === 'exists' ? m.value.images.exists : m.value.images.uploaded,
      color: 'success',
    })
    file.value = null
    alt.value = ''
    if (input.value !== null) input.value.value = ''
    await load()
  } catch (error) {
    toast.add({ title: m.value.images.refused, description: describe(error), color: 'error' })
  } finally {
    busy.value = false
  }
}

async function copy(asset: Asset) {
  await navigator.clipboard.writeText(`![${asset.alt}](${asset.reference})`)
  toast.add({ title: m.value.images.copied, color: 'success' })
}

onMounted(() => load())
</script>

<template>
  <Page :title="m.images.title">
    <p class="text-muted text-sm">{{ m.images.intro }}</p>

    <form class="flex flex-wrap items-end gap-3" @submit.prevent="upload">
      <UFormField :label="m.images.file" required>
        <input
          ref="input"
          type="file"
          :aria-label="m.images.file"
          accept="image/jpeg,image/png,image/webp,image/avif,image/gif,image/svg+xml"
          class="text-sm"
          @change="choose"
        />
      </UFormField>
      <UFormField :label="m.images.alt" :help="m.images.altHelp" required class="min-w-72 flex-1">
        <UInput v-model="alt" class="w-full" />
      </UFormField>
      <UButton type="submit" :loading="busy" :disabled="file === null || alt.trim() === ''">
        {{ m.images.upload }}
      </UButton>
    </form>

    <UAlert v-if="failure" color="error" :title="failure" />

    <p v-else-if="assets.length === 0" class="text-muted text-sm">{{ m.images.none }}</p>

    <ul v-else class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      <li
        v-for="asset in assets"
        :key="asset.id"
        class="border-default flex flex-col gap-2 rounded-md border p-2"
      >
        <img
          :src="asset.url"
          :srcset="asset.srcset ?? undefined"
          sizes="320px"
          :alt="asset.alt"
          loading="lazy"
          class="bg-elevated aspect-video w-full rounded object-contain"
        />
        <p class="truncate text-sm font-medium" :title="asset.alt">{{ asset.alt }}</p>
        <p class="text-muted text-xs">
          {{ asset.filename }} · {{ sizeOf(asset.bytes) }}
          <template v-if="asset.width !== null"> · {{ asset.width }}×{{ asset.height }}</template>
          <template v-if="(asset.widths ?? []).length > 0">
            · {{ m.images.copies((asset.widths ?? []).join(', ')) }}</template
          >
          · {{ formatDate(asset.createdAt) }}
        </p>
        <UButton size="xs" variant="soft" icon="i-lucide-copy" @click="copy(asset)">
          {{ m.images.copy }}
        </UButton>
      </li>
    </ul>

    <UButton v-if="next !== null" variant="ghost" @click="load(next)">{{ m.images.more }}</UButton>
  </Page>
</template>
