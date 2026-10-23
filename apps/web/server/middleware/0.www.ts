import { defineEventHandler, getRequestURL, sendRedirect } from 'h3'
import { apexOf } from '../utils/apex.ts'

export default defineEventHandler((event) => {
  const apex = apexOf(getRequestURL(event))
  if (apex !== null) return sendRedirect(event, apex, 301)
})
