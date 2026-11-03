export const REQUEST_TIMEOUT_MS = 25_000

export const MAX_ANSWER_BYTES = 2 * 1024 * 1024

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>

export class ProviderError extends Error {
  readonly kind: 'refused' | 'unreachable' | 'invalid'
  readonly fix: string

  constructor(kind: 'refused' | 'unreachable' | 'invalid', message: string, fix: string) {
    super(message)
    this.name = 'ProviderError'
    this.kind = kind
    this.fix = fix
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const MAX_MESSAGE_LENGTH = 300
const MIN_REDACTED_SECRET_LENGTH = 8

function jsonOrText(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export function messageOf(body: unknown, secrets: readonly string[]): string {
  const candidates: unknown[] = []
  if (typeof body === 'string') candidates.push(body)
  if (isRecord(body)) {
    candidates.push(body['detail'], body['message'], body['error'])
    const error = body['error']
    if (isRecord(error)) candidates.push(error['message'])
    const errors = body['errors']
    if (Array.isArray(errors) && isRecord(errors[0])) candidates.push(errors[0]['message'])
  }
  let text = candidates.find((item): item is string => typeof item === 'string' && item !== '')
  if (text === undefined) return 'No reason given.'
  for (const secret of secrets) {
    if (secret.length >= MIN_REDACTED_SECRET_LENGTH) text = text.split(secret).join('[credential]')
  }
  return text.length > MAX_MESSAGE_LENGTH
    ? `${text.slice(0, MAX_MESSAGE_LENGTH - '...'.length)}...`
    : text
}

export async function request(
  fetcher: Fetch,
  provider: string,
  url: string,
  init: RequestInit,
): Promise<{ status: number; body: unknown }> {
  let response: Response
  try {
    response = await fetcher(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    throw new ProviderError(
      'unreachable',
      timedOut
        ? `${provider} did not answer in ${REQUEST_TIMEOUT_MS / 1000} s.`
        : `${provider} could not be reached.`,
      'Try again in a minute. If it keeps failing, check that the provider is up.',
    )
  }
  return { status: response.status, body: jsonOrText(await textOf(response, provider)) }
}

async function textOf(response: Response, provider: string): Promise<string> {
  const tooLarge = () =>
    new ProviderError(
      'invalid',
      `${provider} answered more than ${MAX_ANSWER_BYTES / 1024 / 1024} MB.`,
      'Ask for fewer pages, or check that the url points at the provider.',
    )
  if (Number(response.headers.get('content-length') ?? 0) > MAX_ANSWER_BYTES) {
    await response.body?.cancel()
    throw tooLarge()
  }
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_ANSWER_BYTES) {
      await reader.cancel()
      throw tooLarge()
    }
    chunks.push(value)
  }
  const whole = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    whole.set(chunk, at)
    at += chunk.byteLength
  }
  return new TextDecoder().decode(whole)
}
