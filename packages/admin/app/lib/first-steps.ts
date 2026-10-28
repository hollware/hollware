export interface TokenOfSite {
  readonly kind: string
  readonly revokedAt: string | null
  readonly expiresAt: string | null
}

export type StepKey = 'agent' | 'entry' | 'invite' | 'analytics'

export interface Step {
  readonly key: StepKey
  readonly to: string
  readonly done: boolean
}

export function firstSteps(input: {
  readonly tokens: readonly TokenOfSite[]
  readonly people: number
  readonly entries: number
  readonly analytics: boolean
  readonly now: string
}): Step[] {
  const agent = input.tokens.some(
    (token) =>
      token.kind === 'personal' &&
      token.revokedAt === null &&
      (token.expiresAt === null || token.expiresAt > input.now),
  )
  return [
    { key: 'agent', to: '/settings/tokens', done: agent },
    { key: 'entry', to: '/entries/new', done: input.entries > 0 },
    { key: 'invite', to: '/settings/people', done: input.people > 1 },
    { key: 'analytics', to: '/settings/site/analytics', done: input.analytics },
  ]
}
