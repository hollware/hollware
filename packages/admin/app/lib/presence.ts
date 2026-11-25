import { onBeforeUnmount, ref, watch, type Ref } from 'vue'
import type { Api } from './api.ts'

export const BEAT_EVERY_MS = 15_000

export interface Editor {
  readonly id: string
  readonly name: string | null
  readonly kind: 'person' | 'agent'
}

export interface Latest {
  readonly version: number
  readonly savedAt: string
  readonly savedBy: Editor | null
}

interface Beat extends Latest {
  readonly editors: readonly Editor[]
}

export function isNewer(latest: Latest | null, version: number | null): boolean {
  return latest !== null && version !== null && latest.version > version
}

export function editorName(editor: Editor | null, fallback: string): string {
  return editor?.name?.trim() || fallback
}

export function initialsOf(editor: Editor): string {
  const words = (editor.name ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return editor.id.slice(-2).toUpperCase()
  return words
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join('')
    .toUpperCase()
}

export function usePresence(api: Pick<Api, 'admin'>, entryId: Ref<string | null>) {
  const editors = ref<readonly Editor[]>([])
  const latest = ref<Latest | null>(null)
  let timer: ReturnType<typeof setInterval> | undefined
  let order = 0

  async function beat() {
    const id = entryId.value
    if (id === null || document.visibilityState === 'hidden') return
    const sent = ++order
    try {
      const answer = await api.admin<Beat>('presence', { entryId: id })
      if (sent !== order || entryId.value !== id) return
      editors.value = answer.editors
      latest.value = { version: answer.version, savedAt: answer.savedAt, savedBy: answer.savedBy }
    } catch {
      return
    }
  }

  function leave(id: string | null) {
    if (id === null) return
    void api.admin('presence', { entryId: id, leaving: true }).catch(() => undefined)
  }

  function onVisible() {
    if (document.visibilityState === 'visible') void beat()
  }

  watch(
    entryId,
    (id, before) => {
      leave(before ?? null)
      editors.value = []
      latest.value = null
      clearInterval(timer)
      if (id === null) return
      void beat()
      timer = setInterval(() => void beat(), BEAT_EVERY_MS)
    },
    { immediate: true },
  )
  document.addEventListener('visibilitychange', onVisible)
  onBeforeUnmount(() => {
    clearInterval(timer)
    document.removeEventListener('visibilitychange', onVisible)
    leave(entryId.value)
  })

  return { editors, latest, beat }
}
