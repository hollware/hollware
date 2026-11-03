import { defineEventHandler, setResponseHeader } from 'h3'

export default defineEventHandler((event) => {
  setResponseHeader(event, 'content-type', 'text/plain; charset=utf-8')
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /_hollware/',
    '',
    'Sitemap: https://hollware.com/sitemap.xml',
    '',
  ].join('\n')
})
