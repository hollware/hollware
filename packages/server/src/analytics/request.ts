export const REQUEST_TIMEOUT_MS = 25_000

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
    if (secret.length >= 8) text = text.split(secret).join('[credential]')
  }
  return text.length > 300 ? `${text.slice(0, 297)}...` : text
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
  const text = await response.text()
  let body: unknown = text
  try {
    body = JSON.parse(text)
  } catch {}
  return { status: response.status, body }
}
