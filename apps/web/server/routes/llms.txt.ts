import { defineEventHandler, setResponseHeader } from 'h3'
import { readingOrder } from '../../app/utils/docs'

/**
 * The docs for a language model (llmstxt.org): what Hollware is, and every page with its
 * description and a link to its Markdown.
 */
export default defineEventHandler(async (event) => {
  const { site, reader } = useHollware(event)
  const page = await reader.listEntries(site, 'docs', { locale: 'en', limit: 100 })
  const lines = [
    '# Hollware',
    '',
    '> An open-source headless CMS for the agent era, native to Cloudflare Workers. Agents write Markdown over MCP, contracts validate every write, D1 is the single source of truth, and sites read published content over Workers RPC.',
    '',
    'Install with `npm create hollware <dir>`. Each page below is Markdown.',
    '',
    '## Docs',
    '',
    ...readingOrder(page.entries).map(
      (doc) => `- [${doc.title}](https://hollware.com/docs/${doc.slug}.md): ${doc.description}`,
    ),
    '- [MCP tools](https://hollware.com/reference/mcp-tools/): every tool of the MCP server, its scopes and its input schema',
    '',
  ]
  setResponseHeader(event, 'content-type', 'text/plain; charset=utf-8')
  return lines.join('\n')
})
