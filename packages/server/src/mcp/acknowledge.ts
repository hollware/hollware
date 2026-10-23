import { publish } from '@hollware/core'
import {
  acceptedContent,
  inputRequired,
  inputResponse,
  type InputRequiredResult,
  type ServerContext,
} from '@modelcontextprotocol/server'
import * as z from 'zod'

export type PublishInput = z.output<typeof publish.input>
export type PublishOutput = z.output<typeof publish.output>
type Warning = NonNullable<PublishOutput['verdict']>['warnings'][number]

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

export interface Reply {
  readonly given: boolean
  readonly asked: PublishOutput
}

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

export function replyTo(mcp: ServerContext): Reply | null {
  const answer = inputResponse(mcp.mcpReq.inputResponses, QUESTION_KEY)
  if (answer.kind !== 'elicit') return null
  const asked = askedIn(mcp.mcpReq.requestState())
  if (asked === undefined) return null
  const accepted = acceptedContent(mcp.mcpReq.inputResponses, QUESTION_KEY, form)
  return { given: accepted?.acknowledge === true, asked }
}

export function withAcknowledged(input: PublishInput, asked: PublishOutput): PublishInput {
  const acknowledged = new Map(
    input.acknowledgeWarnings.map((warning) => [`${warning.contract}\n${warning.path}`, warning]),
  )
  for (const { contract, path } of warningsOf(asked)) {
    acknowledged.set(`${contract}\n${path}`, { contract, path })
  }
  return { ...input, acknowledgeWarnings: [...acknowledged.values()] }
}
