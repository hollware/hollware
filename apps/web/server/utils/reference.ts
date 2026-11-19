import { OPERATIONS } from '@hollware/core'
import * as z from 'zod'
import { en } from '../../app/i18n/en'
import { eventKinds, readApiEndpoints, WEBHOOK_HEADERS } from '../../app/utils/reference'

function readApiMarkdown(): string {
  const endpoints = readApiEndpoints()
  return [
    `# ${en.readApi.title}`,
    '',
    en.readApi.intro(endpoints.length),
    '',
    ...endpoints.flatMap((endpoint) => [
      `## ${endpoint.method} ${endpoint.path}`,
      '',
      endpoint.description,
      '',
      `${en.readApi.answers} ${endpoint.answers} (${endpoint.statuses.join(', ')})`,
      '',
      ...endpoint.parameters.map(
        (parameter) =>
          `- \`${parameter.name}\` (${parameter.in}${parameter.required ? ', required' : ''})${parameter.description === null ? '' : `: ${parameter.description}`}`,
      ),
      '',
    ]),
  ].join('\n')
}

function eventsMarkdown(): string {
  return [
    `# ${en.events.title}`,
    '',
    en.events.intro,
    '',
    `## ${en.events.delivery}`,
    '',
    en.events.deliveryBody,
    '',
    `- \`${WEBHOOK_HEADERS.event}\`: ${en.events.eventHeader}`,
    `- \`${WEBHOOK_HEADERS.timestamp}\`: ${en.events.timestampHeader}`,
    `- \`${WEBHOOK_HEADERS.signature}\`: ${en.events.signatureHeader}`,
    '',
    ...eventKinds().flatMap((kind) => [
      `## ${kind.kinds.join(', ')}`,
      '',
      ...kind.fields.map(
        (field) =>
          `- \`${field.name}\` (${field.type})${field.description === null ? '' : `: ${field.description}`}`,
      ),
      '',
    ]),
  ].join('\n')
}

function mcpToolsMarkdown(): string {
  const tools = [...OPERATIONS].sort((a, b) => a.name.localeCompare(b.name))
  const lines = [
    '# MCP tools',
    '',
    `The ${tools.length} tools of \`/mcp\`, as \`tools/list\` describes them to a client with every scope. A personal token lists only the tools its scopes allow, and an OAuth client lists them all; a call without the scope gets a 403 that names what is missing.`,
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
  return lines.join('\n')
}

const REFERENCE: Readonly<Record<string, () => string>> = {
  '/reference/mcp-tools.md': mcpToolsMarkdown,
  '/reference/read-api.md': readApiMarkdown,
  '/reference/events.md': eventsMarkdown,
}

export const REFERENCE_PATHS = Object.keys(REFERENCE)

export function referenceMarkdownOf(path: string): string | null {
  return Object.hasOwn(REFERENCE, path) ? (REFERENCE[path]?.() ?? null) : null
}
