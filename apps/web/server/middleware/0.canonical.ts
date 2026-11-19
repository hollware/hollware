import { defineEventHandler, getRequestURL, sendRedirect } from 'h3'
import { canonicalRedirectOf } from '../utils/canonical.ts'

export default defineEventHandler((event) => {
  if (event.method !== 'GET' && event.method !== 'HEAD') return
  const canonical = canonicalRedirectOf(getRequestURL(event))
  if (canonical !== null) return sendRedirect(event, canonical, 301)
})
