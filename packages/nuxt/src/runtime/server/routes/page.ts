import {
  clearedPreviewCookie,
  isPreviewRefusal,
  isSecureRequest,
  previewTokenFromCookie,
} from '@hollware/client'
import { appendResponseHeader, createError, defineEventHandler, getHeader, getQuery } from 'h3'
import { answer, forPage } from '../answer.ts'
import { useHollware } from '../reader.ts'
import { requestUrl } from '../url.ts'

export default defineEventHandler(async (event) => {
  const { site, reader } = useHollware(event)
  const query = getQuery(event)['path']
  const path = typeof query === 'string' && query.startsWith('/') ? query : '/'
  const preview = previewTokenFromCookie(getHeader(event, 'cookie'))
  const options = preview === undefined ? {} : { preview }
  const refused = (error: unknown): never => {
    if (preview === undefined || !isPreviewRefusal(error)) throw error
    const secure = isSecureRequest(requestUrl(event))
    appendResponseHeader(event, 'set-cookie', clearedPreviewCookie({ secure }))
    throw createError({ statusCode: 404, statusMessage: 'Not found in Hollware' })
  }
  const resolved = await answer(event, () => reader.resolvePath(site, path, options).catch(refused))
  if (resolved.outcome === 'redirect') return { outcome: 'redirect', path: resolved.path }
  if (resolved.outcome !== 'ok') {
    throw createError({ statusCode: 404, statusMessage: 'Not found in Hollware' })
  }
  const found = await answer(event, () =>
    reader
      .getEntry(site, resolved.collection, resolved.slug, resolved.locale, {
        formats: ['document'],
        ...options,
      })
      .catch(refused),
  )
  return { outcome: found.outcome, entry: forPage(found.entry), ancestors: found.ancestors ?? [] }
})
