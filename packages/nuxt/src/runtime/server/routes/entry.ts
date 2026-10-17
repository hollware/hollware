import {
  clearedPreviewCookie,
  isPreviewRefusal,
  isSecureRequest,
  previewTokenFromCookie,
} from '@hollware/client'
import {
  appendResponseHeader,
  createError,
  defineEventHandler,
  getHeader,
  getRouterParam,
} from 'h3'
import { answer, forPage } from '../answer.ts'
import { useHollware } from '../reader.ts'
import { requestUrl } from '../url.ts'

export default defineEventHandler(async (event) => {
  const { site, reader } = useHollware(event)
  const param = (name: string) => getRouterParam(event, name) ?? ''
  // The token of a visitor who opened the admin's link, kept in a cookie by `preview-exchange`.
  const preview = previewTokenFromCookie(getHeader(event, 'cookie'))
  const found = await answer(event, () =>
    reader
      .getEntry(site, param('collection'), param('slug'), param('locale'), {
        // The Comark document, which <HollwareContent> renders.
        formats: ['document'],
        // The latest revision of the entry the token names.
        ...(preview === undefined ? {} : { preview }),
      })
      .catch((error: unknown) => {
        // Expired or invalid: the page is what it is without a token, and the cookie goes. A token
        // of another entry is no refusal (Hollware answers it as no entry), so it stays.
        if (preview === undefined || !isPreviewRefusal(error)) throw error
        const secure = isSecureRequest(requestUrl(event))
        appendResponseHeader(event, 'set-cookie', clearedPreviewCookie({ secure }))
        throw createError({ statusCode: 404, statusMessage: 'Not found in Hollware' })
      }),
  )
  return { outcome: found.outcome, entry: forPage(found.entry) }
})
