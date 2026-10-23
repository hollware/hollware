import { OPERATIONS } from '@hollware/core'
import { defineEventHandler, getRequestURL, setResponseHeader } from 'h3'
import * as z from 'zod'

export default defineEventHandler((event) => {
  if (getRequestURL(event).pathname !== '/reference/mcp-tools.md') return
  const tools = [...OPERATIONS].sort((a, b) => a.name.localeCompare(b.name))
  const lines = [
    '# MCP tools',
    '',
    `The ${tools.length} tools of \`/mcp\`, as \`tools/list\` describes them. A tool checks its scopes when it runs: a token without them gets a 403 that names what is missing.`,
    '',
    ...tools.flatMap((tool) => [
      `## ${tool.name}`,
      '',
      tool.description,
      '',
      `- Effect: ${tool.effect}`,
      `- Scopes: ${tool.scopes.map((scope) => `\`${scope}\``).join(', ') || 'none'}`,
      '',
      '```json',
      JSON.stringify(z.toJSONSchema(tool.input, { io: 'input' }), null, 2),
      '```',
      '',
    ]),
  ]
  setResponseHeader(event, 'content-type', 'text/markdown; charset=utf-8')
  return lines.join('\n')
})
