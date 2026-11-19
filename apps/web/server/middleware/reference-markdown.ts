import { defineEventHandler, getRequestURL, setResponseHeader } from 'h3'
import { canonicalLinkOf } from '../../app/utils/seo'
import { referenceMarkdownOf } from '../utils/reference'

export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname
  const markdown = referenceMarkdownOf(path)
  if (markdown === null) return
  setResponseHeader(event, 'content-type', 'text/markdown; charset=utf-8')
  setResponseHeader(event, 'link', canonicalLinkOf(path.replace(/\.md$/, '/')))
  return markdown
})
