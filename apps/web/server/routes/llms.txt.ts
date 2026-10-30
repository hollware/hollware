import { defineEventHandler, setResponseHeader } from 'h3'
import { docLinks } from '../../app/utils/docs'

export default defineEventHandler(async (event) => {
  const { site, reader } = useHollware(event)
  const navigation = await reader.getNavigation(site, 'docs', { locale: 'en' })
  const lines = [
    '# Hollware',
    '',
    '> An open-source headless CMS for the agent era, native to Cloudflare Workers. Agents write Markdown over MCP, contracts validate every write, D1 is the single source of truth, and sites read published content over Workers RPC.',
    '',
    'Install with `npm create hollware <dir>`. Each page below is Markdown.',
    '',
    '## Docs',
    '',
    ...docLinks(navigation).map(
      (doc) => `- [${doc.title}](https://hollware.com/docs/${doc.slug}.md): ${doc.description}`,
    ),
    '- [MCP tools](https://hollware.com/reference/mcp-tools.md): every tool of the MCP server, its scopes and its input schema',
    '- [Read API](https://hollware.com/reference/read-api.md): every endpoint of /v1, what it answers and its parameters',
    '- [Webhook events](https://hollware.com/reference/events.md): every event a webhook gets, its fields, and how to verify it',
    '',
  ]
  setResponseHeader(event, 'content-type', 'text/plain; charset=utf-8')
  return lines.join('\n')
})
