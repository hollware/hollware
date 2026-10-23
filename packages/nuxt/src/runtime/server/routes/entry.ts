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
  const preview = previewTokenFromCookie(getHeader(event, 'cookie'))
  const found = await answer(event, () =>
    reader
      .getEntry(site, param('collection'), param('slug'), param('locale'), {
        formats: ['document'],
        ...(preview === undefined ? {} : { preview }),
      })
      .catch((error: unknown) => {
        if (preview === undefined || !isPreviewRefusal(error)) throw error
        const secure = isSecureRequest(requestUrl(event))
        appendResponseHeader(event, 'set-cookie', clearedPreviewCookie({ secure }))
        throw createError({ statusCode: 404, statusMessage: 'Not found in Hollware' })
      }),
  )
  return { outcome: found.outcome, entry: forPage(found.entry) }
})
