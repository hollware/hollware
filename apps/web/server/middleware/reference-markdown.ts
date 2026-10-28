import { defineEventHandler, getRequestURL, setResponseHeader } from 'h3'
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

export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname
  const markdown =
    path === '/reference/read-api.md'
      ? readApiMarkdown()
      : path === '/reference/events.md'
        ? eventsMarkdown()
        : null
  if (markdown === null) return
  setResponseHeader(event, 'content-type', 'text/markdown; charset=utf-8')
  return markdown
})
