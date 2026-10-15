import { HollwareError, type Operation, type OperationName } from '@hollware/core'
import type { CallToolResult } from '@modelcontextprotocol/server'
import { OUTPUT_CAP_BYTES } from '../limits.ts'

/** What a handler answered, checked against the output schema of its spec. */
export interface Answer {
  /** The output as the schema keeps it: only the fields the schema names. */
  readonly output: Record<string, unknown>
  readonly outcome: string
  /** Whether the outcome is an error for the caller, as the spec says. */
  readonly isError: boolean
}

/**
 * Checks what a handler returned against the output schema of its spec, and keeps only the
 * fields the schema names, so a handler that hands over a row with more columns than the schema
 * has cannot leak them. The SDK checks the same schema again, but only for results that are not
 * errors; an answer that does not match is a bug of the handler, and it throws, so that the call
 * ends as `internal`.
 */
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

/**
 * The fix of `output_too_large`, for each operation. A read says how to ask for less. A write
 * has already run when its answer turns out too large, so it says to look at the state it left.
 */
const OUTPUT_TOO_LARGE_FIX = {
  approve_review:
    'The operation ran and its change may have been applied: read the review with list_reviews before you repeat it.',
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
  publish:
    'The operation ran and its change may have been applied: read the entry with get_entry before you repeat it.',
  request_changes:
    'The operation ran and its change may have been applied: read the review with list_reviews before you repeat it.',
  search: 'Ask for less: pass a smaller limit.',
  unpublish:
    'The operation ran and its change may have been applied: read the entry with get_entry before you repeat it.',
  update_draft:
    'The operation ran and its change may have been applied: read the entry with get_entry before you repeat it.',
  validate:
    'The verdict lists more problems than fit in one answer. Fix the first ones and validate again.',
} as const satisfies Record<OperationName, string>

/**
 * The result of a call: the answer as `structuredContent`, the same JSON as text for clients
 * that do not read structured content, and `isError` as the spec says for the outcome. An answer
 * whose JSON is over the cap, counted in UTF-8 bytes, is the error `output_too_large`: Hollware
 * never truncates content.
 */
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

/**
 * The result of a call that ended in an error: `{ code, message, fix }` as text, and no
 * structured content. The tools declare an output schema, and clients check the structured
 * content they get against it even when `isError` is set, so an error that is not an output of
 * the operation must not carry any.
 */
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
