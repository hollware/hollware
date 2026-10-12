import { publish } from '@hollware/core'
import {
  acceptedContent,
  inputRequired,
  inputResponse,
  type InputRequiredResult,
  type ServerContext,
} from '@modelcontextprotocol/server'
import * as z from 'zod'

/**
 * Acknowledging the warnings of a publish, asked as a multi round-trip request (MRTR). A client of
 * the 2026 era that can show a form is asked the question, and the person's answer comes back in
 * the retry of the call. Every other client gets the `needs_acknowledgement` answer and
 * acknowledges with `acknowledgeWarnings` itself: that argument is the way in for every client,
 * so an acknowledgement given here is never more than the client could have sent by hand.
 */

export type PublishInput = z.output<typeof publish.input>
export type PublishOutput = z.output<typeof publish.output>
type Warning = NonNullable<PublishOutput['verdict']>['warnings'][number]

/** The key of the question in `inputRequests`, and of the answer in `inputResponses`. */
const QUESTION_KEY = 'acknowledge_warnings'

const form = z.object({
  acknowledge: z.boolean().describe('Publish with these warnings.'),
})

export function warningsOf(output: PublishOutput): readonly Warning[] {
  return output.verdict?.warnings ?? []
}

function question(output: PublishOutput, warnings: readonly Warning[]): string {
  const subject =
    output.entry === undefined
      ? 'this entry'
      : `${output.entry.collection}/${output.entry.locale}/${output.entry.slug}`
  const count = warnings.length === 1 ? '1 warning' : `${warnings.length} warnings`
  const lines = warnings.map((warning, index) => {
    const where =
      warning.line === undefined ? warning.path : `${warning.path}, line ${warning.line}`
    return `${index + 1}. ${warning.contract} at ${where}: ${warning.message} Fix: ${warning.fix}`
  })
  return [`Publish ${subject} with ${count}?`, '', ...lines].join('\n')
}

/**
 * The question to put to the person: every warning with its fix, and one box to tick. The
 * `needs_acknowledgement` answer travels in `requestState`, because the retry is a request of its
 * own and the server keeps nothing between the two: it is what a refusal answers, and where the
 * warnings to acknowledge come from. The client sends the state back as it got it, and it could
 * write any state it likes; the state grants nothing that `acknowledgeWarnings` does not, since a
 * client sends that argument by hand.
 */
export function askToAcknowledge(output: PublishOutput): InputRequiredResult {
  return inputRequired({
    inputRequests: {
      [QUESTION_KEY]: inputRequired.elicit({
        message: question(output, warningsOf(output)),
        requestedSchema: form,
      }),
    },
    requestState: JSON.stringify(output),
  })
}

/** What the person answered, with the `needs_acknowledgement` answer that they were shown. */
export interface Reply {
  readonly given: boolean
  readonly asked: PublishOutput
}

/** The answer that the state of a retry carries, or `undefined` if it carries none that we wrote. */
function askedIn(state: unknown): PublishOutput | undefined {
  if (typeof state !== 'string') return undefined
  let json: unknown
  try {
    json = JSON.parse(state)
  } catch {
    return undefined
  }
  const parsed = publish.output.safeParse(json)
  return parsed.success && parsed.data.outcome === 'needs_acknowledgement' ? parsed.data : undefined
}

/**
 * The person's reply, when the call is the retry of a question we asked, and `null` when it is
 * not: a first call, or a retry that lost the state, which is treated as a first call. A decline,
 * a cancel and a form accepted with the box empty are all a refusal.
 */
export function replyTo(mcp: ServerContext): Reply | null {
  const answer = inputResponse(mcp.mcpReq.inputResponses, QUESTION_KEY)
  if (answer.kind !== 'elicit') return null
  const asked = askedIn(mcp.mcpReq.requestState())
  if (asked === undefined) return null
  const accepted = acceptedContent(mcp.mcpReq.inputResponses, QUESTION_KEY, form)
  return { given: accepted?.acknowledge === true, asked }
}

/**
 * The input of the publish that follows an acceptance: the warnings the person was shown, added
 * to those the client already acknowledged, each contract and path once.
 */
export function withAcknowledged(input: PublishInput, asked: PublishOutput): PublishInput {
  const acknowledged = new Map(
    input.acknowledgeWarnings.map((warning) => [`${warning.contract}\n${warning.path}`, warning]),
  )
  // A warning the client already acknowledged keeps its place: setting a key again does not move it.
  for (const { contract, path } of warningsOf(asked)) {
    acknowledged.set(`${contract}\n${path}`, { contract, path })
  }
  return { ...input, acknowledgeWarnings: [...acknowledged.values()] }
}
