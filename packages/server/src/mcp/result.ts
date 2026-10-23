import { HollwareError, type Operation, type OperationName } from '@hollware/core'
import type { CallToolResult } from '@modelcontextprotocol/server'
import { OUTPUT_CAP_BYTES } from '../limits.ts'

export interface Answer {
  readonly output: Record<string, unknown>
  readonly outcome: string
  readonly isError: boolean
}

export function readAnswer(spec: Operation, value: unknown): Answer {
  const parsed = spec.output.safeParse(value)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    throw new TypeError(
      `${spec.name} answered something that is not an output of its spec: ${issues.join('; ')}`,
    )
  }
  const { outcome } = parsed.data
  const isError = Object.entries(spec.outcomes).some(
    ([name, info]) => name === outcome && info.isError,
  )
  return { output: parsed.data, outcome, isError }
}

const encoder = new TextEncoder()

const OUTPUT_TOO_LARGE_FIX = {
  approve_review:
    'The operation ran and its change may have been applied: read the review with list_reviews before you repeat it.',
  comment_review:
    'The operation ran and its comment may have been added: read the review with list_reviews before you repeat it.',
  content_stats: 'Ask for less: pass a smaller limit.',
  create_draft:
    'The operation ran and its change may have been applied: read the entry with get_entry before you repeat it.',
  describe_site:
    'The description of the site does not fit in one answer. Document fewer collections, components and contracts, or shorten their descriptions.',
  get_entry:
    'Ask for one format at a time with formats: markdown, document or html, instead of several together.',
  get_translations:
    'The translations do not fit in one answer. Read each one with get_entry instead.',
  list_entries:
    'Ask for less: pass a smaller limit, or narrow the list with locale, tag or status.',
  list_reviews: 'Ask for less: pass a smaller limit.',
  list_assets: 'Ask for less: pass a smaller limit.',
  get_asset: 'Nothing to ask for less of: the answer is one asset. Try again.',
  update_asset: 'Nothing to ask for less of: the answer is one asset. Try again.',
  schedule_unpublish:
    'The operation ran and its change may have been applied: read the entry with get_entry before you repeat it.',
  list_backups: 'Nothing to ask for less of: the answer is a list of dates. Try again.',
  move_entry:
    'The operation ran and its change may have been applied: read the entry with get_entry before you repeat it.',
  list_redirects: 'Ask for less: pass a smaller limit, and the nextCursor of a page for the next.',
  list_revisions: 'Ask for less: pass a smaller limit, and the nextCursor of a page for the next.',
  get_revision:
    'The revision is larger than one answer holds: read the entry with get_entry, or its Markdown from an export.',
  restore_revision:
    'The operation ran and its change may have been applied: read the entry with get_entry before you repeat it.',
  upload_asset:
    'The operation ran and the image may have been kept: list the images with list_assets before you upload it again.',
  publish:
    'The operation ran and its change may have been applied: read the entry with get_entry before you repeat it.',
  request_changes:
    'The operation ran and its change may have been applied: read the review with list_reviews before you repeat it.',
  reject_review:
    'The operation ran and its change may have been applied: read the review with list_reviews before you repeat it.',
  request_review:
    'The operation ran and its review may have been asked: read it with list_reviews before you repeat it.',
  search: 'Ask for less: pass a smaller limit.',
  unpublish:
    'The operation ran and its change may have been applied: read the entry with get_entry before you repeat it.',
  update_draft:
    'The operation ran and its change may have been applied: read the entry with get_entry before you repeat it.',
  create_site:
    'The site was made and holds little: read it with get_structure from a token of that site.',
  delete_site: 'Nothing to ask for less of: the answer is a count. Try again.',
  delete_entry:
    'The operation ran and its change may have been applied: list the trash with list_entries and trashed before you repeat it.',
  restore_entry:
    'The operation ran and its change may have been applied: read the entry with get_entry before you repeat it.',
  make_webhook_secret: 'Nothing to ask for less of: the answer is one secret. Try again.',
  get_analytics: 'Nothing to ask for less of: the answer is one connection. Try again.',
  connect_analytics: 'Nothing to ask for less of: the answer is an outcome. Try again.',
  disconnect_analytics: 'Nothing to ask for less of: the answer is an outcome. Try again.',
  get_structure:
    'The structure does not fit in one answer: read the collections with describe_site instead, and change them one at a time with set_collection.',
  restore_site: 'Nothing to ask for less of: the answer is an outcome. Try again.',
  set_collection:
    'Too many problems for one answer: fix the first ones and send the collection again.',
  update_site:
    'Too many problems for one answer: fix the first ones, or change one collection at a time with set_collection.',
  validate:
    'The verdict lists more problems than fit in one answer. Fix the first ones and validate again.',
} as const satisfies Record<OperationName, string>

export function answerResult(spec: Operation, answer: Answer): CallToolResult {
  const text = JSON.stringify(answer.output)
  const bytes = encoder.encode(text).length
  if (bytes > OUTPUT_CAP_BYTES) {
    throw new HollwareError(
      'output_too_large',
      `The answer of ${spec.name} is ${bytes} bytes, over the cap of ${OUTPUT_CAP_BYTES} bytes.`,
      OUTPUT_TOO_LARGE_FIX[spec.name],
    )
  }
  return {
    content: [{ type: 'text', text }],
    structuredContent: answer.output,
    isError: answer.isError,
  }
}

export function errorResult(error: HollwareError): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ code: error.code, message: error.message, fix: error.fix }),
      },
    ],
    isError: true,
  }
}
