import type { Memory } from './memory.ts'

/** A message of a conversation with a model. */
export interface Message {
  readonly role: 'system' | 'user'
  readonly content: string
}

/** A model that answers a conversation with text. */
export type Model = (messages: readonly Message[]) => Promise<string>

/** The model of Workers AI the agents use when the options name none. */
export const DEFAULT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'

interface AiBinding {
  run(model: string, input: object, options?: object): Promise<unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function textOf(answer: unknown): string | null {
  if (typeof answer === 'string') return answer
  if (!isRecord(answer)) return null
  if (typeof answer['response'] === 'string') return answer['response']
  const choices = answer['choices']
  if (Array.isArray(choices) && isRecord(choices[0]) && isRecord(choices[0]['message'])) {
    const content = choices[0]['message']['content']
    if (typeof content === 'string') return content
  }
  return null
}

/** A model of Workers AI, through an AI Gateway when its id is given. */
export function workersAiModel(
  ai: AiBinding,
  model: string,
  options: { readonly gateway?: string; readonly maxTokens?: number } = {},
): Model {
  return async (messages) => {
    const answer = await ai.run(
      model,
      {
        messages: messages.map(({ role, content }) => ({ role, content })),
        max_tokens: options.maxTokens ?? 4096,
      },
      options.gateway === undefined ? undefined : { gateway: { id: options.gateway } },
    )
    const text = textOf(answer)
    if (text === null) throw new Error(`${model} answered no text`)
    return text
  }
}

/** The day's cap of model calls was reached; the agents stop until the next day. */
export class DailyLimitReached extends Error {
  constructor(limit: number) {
    super(`The agents reached their ${limit} model calls of the day`)
    this.name = 'DailyLimitReached'
  }
}

/** A model that counts its calls of the day in the memory and refuses one over `limit`. */
export function capped(model: Model, memory: Memory, limit: number, today: () => string): Model {
  return async (messages) => {
    const key = `usage:${today()}`
    const used = Number((await memory.get(key)) ?? '0')
    if (used >= limit) throw new DailyLimitReached(limit)
    await memory.put(key, String(used + 1), 2 * 86_400)
    return model(messages)
  }
}
