import { PREVIEW_READY_MESSAGE } from '@hollware/core'
import { defineNuxtPlugin, useNuxtData } from 'nuxt/app'
import { liveEntryOf, withLiveEntry } from './live.ts'
import { embedScrollKey } from './tags.ts'

interface PreviewWindow {
  readonly location: { readonly href: string }
  readonly scrollY: number
  readonly parent: { postMessage(message: unknown, targetOrigin: string): void }
  readonly sessionStorage: {
    getItem(key: string): string | null
    setItem(key: string, value: string): void
  }
  addEventListener(type: 'scroll', listener: () => void, options: { passive: boolean }): void
  addEventListener(
    type: 'message',
    listener: (event: { readonly source: unknown; readonly data: unknown }) => void,
  ): void
  scrollTo(left: number, top: number): void
}

function stored(page: PreviewWindow, key: string): number {
  try {
    return Number(page.sessionStorage.getItem(key)) || 0
  } catch {
    return 0
  }
}

function store(page: PreviewWindow, key: string) {
  try {
    page.sessionStorage.setItem(key, String(page.scrollY))
  } catch {
    return
  }
}

export default defineNuxtPlugin({
  name: 'hollware:embedded-preview-client',
  setup(nuxtApp) {
    const page: PreviewWindow = Reflect.get(globalThis, 'window')
    const key = embedScrollKey(page.location.href)
    if (key === null) return
    page.addEventListener('scroll', () => store(page, key), { passive: true })
    page.addEventListener('message', (event) => {
      if (event.source !== page.parent) return
      const entry = liveEntryOf(event.data)
      if (entry === null) return
      void nuxtApp.runWithContext(() => {
        for (const name of Object.keys(nuxtApp.payload.data)) {
          const { data } = useNuxtData(name)
          const next = withLiveEntry(data.value, entry)
          if (next !== null) data.value = next
        }
      })
    })
    nuxtApp.hook('app:suspense:resolve', () => {
      page.scrollTo(0, stored(page, key))
    })
    nuxtApp.hook('app:mounted', () => {
      page.parent.postMessage({ type: PREVIEW_READY_MESSAGE }, '*')
    })
  },
})
