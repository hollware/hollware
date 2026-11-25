import { PREVIEW_ENTRY_MESSAGE, PREVIEW_READY_MESSAGE } from '@hollware/core'
import type { Api } from './api.ts'

export interface PreviewLink {
  readonly token: string
  readonly expiresAt: string
  readonly url: string | null
  readonly embedUrl?: string | null
}

export async function openPreview(
  api: Pick<Api, 'admin'>,
  entryId: string,
  open: (url: string) => void,
): Promise<'opened' | 'no_url'> {
  const link = await api.admin<PreviewLink>('preview', { entryId })
  if (link.url === null) return 'no_url'
  open(link.url)
  return 'opened'
}

export const RENEW_BEFORE_MS = 5 * 60_000

export function refreshOf(link: PreviewLink | null, now: number): 'renew' | 'reload' {
  if (link === null) return 'renew'
  const expires = Date.parse(link.expiresAt)
  return Number.isNaN(expires) || expires - now < RENEW_BEFORE_MS ? 'renew' : 'reload'
}

export interface Embed {
  readonly src: string
  readonly sandbox: string
}

const SANDBOX = 'allow-scripts allow-forms allow-popups'

export function embedOf(link: PreviewLink | null, adminOrigin: string): Embed | null {
  const src = link?.embedUrl ?? null
  if (src === null || !URL.canParse(src)) return null
  const url = new URL(src)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  return {
    src: url.href,
    sandbox: url.origin === adminOrigin ? SANDBOX : `${SANDBOX} allow-same-origin`,
  }
}

export const DEVICES = {
  desktop: null,
  tablet: 768,
  phone: 390,
} as const

export type Device = keyof typeof DEVICES

export const LIVE_DELAY_MS = 200

export function isReadyMessage(data: unknown): boolean {
  return (
    typeof data === 'object' && data !== null && Reflect.get(data, 'type') === PREVIEW_READY_MESSAGE
  )
}

export async function liveEntryMessage(
  api: Pick<Api, 'admin'>,
  entryId: string,
  markdown: string,
): Promise<{ readonly type: string; readonly entry: unknown } | null> {
  try {
    const answer = await api.admin<{ entry: unknown }>('preview/document', { entryId, markdown })
    return { type: PREVIEW_ENTRY_MESSAGE, entry: answer.entry }
  } catch {
    return null
  }
}
