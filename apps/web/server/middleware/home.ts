import { defineEventHandler, getRequestURL, sendRedirect } from 'h3'

export default defineEventHandler((event) => {
  const url = getRequestURL(event)
  const home = /^(\/es)?\/home\/?$/.exec(url.pathname)
  if (home === null) return
  return sendRedirect(event, `${home[1] ?? ''}/${url.search}`, 302)
})
