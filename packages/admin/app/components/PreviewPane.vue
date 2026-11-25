<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useMessages } from '../i18n/index.ts'
import { ApiError } from '../lib/api.ts'
import { api } from '../lib/session.ts'
import {
  DEVICES,
  embedOf,
  isReadyMessage,
  LIVE_DELAY_MS,
  liveEntryMessage,
  refreshOf,
  type Device,
  type PreviewLink,
} from '../lib/site-preview.ts'

const props = defineProps<{ entryId: string; version: number; title: string; markdown: string }>()

const m = useMessages()
const link = ref<PreviewLink | null>(null)
const loaded = ref(false)
const failure = ref<string | null>(null)
const frame = ref(0)
const device = ref<Device>('desktop')
const iframe = ref<HTMLIFrameElement | null>(null)
const live = ref(false)
const embed = computed(() => embedOf(link.value, window.location.origin))
const width = computed(() => {
  const pixels = DEVICES[device.value]
  return pixels === null ? '100%' : `${pixels}px`
})

async function renew() {
  failure.value = null
  live.value = false
  try {
    link.value = await api.admin<PreviewLink>('preview', { entryId: props.entryId })
    frame.value++
  } catch (error) {
    failure.value = error instanceof ApiError ? `${error.message} ${error.fix}` : String(error)
  } finally {
    loaded.value = true
  }
}

function reload() {
  live.value = false
  if (refreshOf(link.value, Date.now()) === 'renew') void renew()
  else frame.value++
}

let sending: ReturnType<typeof setTimeout> | undefined
let sent = 0

async function send() {
  const target = iframe.value?.contentWindow
  const origin = embed.value === null ? null : new URL(embed.value.src).origin
  if (!live.value || target === null || target === undefined || origin === null) return
  const order = ++sent
  const message = await liveEntryMessage(api, props.entryId, props.markdown)
  if (message !== null && order === sent) target.postMessage(message, origin)
}

function onMessage(event: MessageEvent) {
  if (event.source !== iframe.value?.contentWindow || !isReadyMessage(event.data)) return
  live.value = true
  void send()
}

window.addEventListener('message', onMessage)
onBeforeUnmount(() => {
  window.removeEventListener('message', onMessage)
  clearTimeout(sending)
})

watch(
  () => props.markdown,
  () => {
    clearTimeout(sending)
    if (live.value) sending = setTimeout(() => void send(), LIVE_DELAY_MS)
  },
)

watch(
  () => props.entryId,
  () => {
    link.value = null
    loaded.value = false
    void renew()
  },
  { immediate: true },
)
watch(
  () => props.version,
  () => {
    if (!live.value) reload()
  },
)

const devices = computed(() =>
  (Object.keys(DEVICES) as Device[]).map((value) => ({
    value,
    label: m.value.pane.devices[value],
    icon: {
      desktop: 'i-lucide-monitor',
      tablet: 'i-lucide-tablet',
      phone: 'i-lucide-smartphone',
    }[value],
  })),
)
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex items-center gap-1 border-b border-default px-3 py-2">
      <div role="group" :aria-label="m.pane.width" class="flex items-center gap-1">
        <UTooltip v-for="option in devices" :key="option.value" :text="option.label">
          <UButton
            :icon="option.icon"
            size="xs"
            color="neutral"
            :variant="device === option.value ? 'soft' : 'ghost'"
            :aria-label="option.label"
            :aria-pressed="device === option.value"
            @click="device = option.value"
          />
        </UTooltip>
      </div>
      <UTooltip :text="m.pane.reload">
        <UButton
          icon="i-lucide-rotate-cw"
          size="xs"
          color="neutral"
          variant="ghost"
          class="ms-auto"
          :aria-label="m.pane.reload"
          :disabled="embed === null"
          @click="reload"
        />
      </UTooltip>
    </div>
    <div class="min-h-0 flex-1 overflow-auto bg-elevated/50">
      <p v-if="!loaded" class="p-6 text-sm text-muted">{{ m.common.loading }}</p>
      <UAlert
        v-else-if="failure !== null"
        :title="m.pane.failed"
        :description="failure"
        icon="i-lucide-triangle-alert"
        color="error"
        variant="subtle"
        class="m-4 w-auto"
        :actions="[{ label: m.pane.tryAgain, variant: 'outline', onClick: () => void renew() }]"
      />
      <UEmpty
        v-else-if="embed === null"
        icon="i-lucide-eye-off"
        :title="m.pane.noPage"
        :description="m.pane.noPageBody"
        class="m-4"
      />
      <iframe
        v-else
        ref="iframe"
        :key="frame"
        :src="embed.src"
        :sandbox="embed.sandbox"
        :title="m.pane.frameTitle(title)"
        referrerpolicy="no-referrer"
        class="mx-auto block h-full border-0 bg-white"
        :style="{ width, maxWidth: '100%' }"
      />
    </div>
  </div>
</template>
