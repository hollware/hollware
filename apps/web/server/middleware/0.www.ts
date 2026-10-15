import { defineEventHandler, getRequestURL, sendRedirect } from 'h3'
import { apexOf } from '../utils/apex.ts'

/**
 * www.hollware.com answers with a permanent redirect to hollware.com, path and query kept: one
 * origin for search engines, and the one origin whose pages the docs site counts views from
 * (ADR-031). The name puts it before every other middleware.
 */
export default defineEventHandler((event) => {
  const apex = apexOf(getRequestURL(event))
  if (apex !== null) return sendRedirect(event, apex, 301)
})
