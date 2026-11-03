import { defineEventHandler, setResponseHeader } from 'h3'
import { docLinks } from '../../app/utils/docs'
import { markdownPathOf, ORIGIN } from '../../app/utils/pages'
import { listedPages, type ListedPage } from '../utils/pages'

const SUMMARY =
  'An open-source headless CMS for the agent era, native to Cloudflare Workers. Agents write Markdown over MCP, contracts validate every write, D1 is the single source of truth, and sites read published content over Workers RPC.'

const SECTIONS = [
  ['features', 'Features'],
  ['compare', 'Comparisons'],
  ['glossary', 'Glossary'],
] as const

const line = (page: ListedPage) =>
  `- [${page.title}](${ORIGIN}${markdownPathOf(page.collection, page.slug, 'en')}): ${page.description}`

export default defineEventHandler(async (event) => {
  const { site, reader } = useHollware(event)
  const [pages, navigation] = await Promise.all([
    listedPages(reader, site),
    reader.getNavigation(site, 'docs', { locale: 'en' }),
  ])
  const shown = pages.filter((page) => !page.noindex)
  const home = shown.find((page) => page.collection === 'pages' && page.slug === 'home')
  const install = shown.find((page) => page.collection === 'pages' && page.slug === 'install')
  const lines = [
    '# Hollware',
    '',
    `> ${home?.description || SUMMARY}`,
    '',
    install === undefined
      ? 'Install with `npm create hollware <dir> --owner-email <address>`. Each page below is Markdown.'
      : `To install it, an agent follows ${ORIGIN}/install.md. Each page below is Markdown.`,
    '',
    ...(home === undefined
      ? []
      : ['## Product', '', line(home), ...(install ? [line(install)] : []), '']),
    ...SECTIONS.flatMap(([collection, title]) => {
      const listed = shown.filter((page) => page.collection === collection)
      return listed.length === 0 ? [] : [`## ${title}`, '', ...listed.map(line), '']
    }),
    '## Docs',
    '',
    ...docLinks(navigation).map(
      (doc) => `- [${doc.title}](${ORIGIN}/docs/${doc.slug}.md): ${doc.description}`,
    ),
    `- [MCP tools](${ORIGIN}/reference/mcp-tools.md): every tool of the MCP server, its scopes and its input schema`,
    `- [Read API](${ORIGIN}/reference/read-api.md): every endpoint of /v1, what it answers and its parameters`,
    `- [Webhook events](${ORIGIN}/reference/events.md): every event a webhook gets, its fields, and how to verify it`,
    '',
  ]
  setResponseHeader(event, 'content-type', 'text/plain; charset=utf-8')
  return lines.join('\n')
})
