export interface TokenForm {
  readonly label: string
  readonly read: boolean
  readonly scopes: readonly string[]
  readonly days: number | undefined
  readonly never: boolean
}

export interface TokenRequest {
  readonly label: string
  readonly kind?: 'read'
  readonly scopes?: readonly string[]
  readonly expiresInDays?: number | null
}

export function tokenRequest(form: TokenForm): TokenRequest {
  const expiry =
    form.never && !form.read
      ? { expiresInDays: null }
      : typeof form.days === 'number' && Number.isInteger(form.days) && form.days > 0
        ? { expiresInDays: form.days }
        : {}
  return {
    label: form.label,
    ...(form.read ? { kind: 'read' as const } : { scopes: [...form.scopes] }),
    ...expiry,
  }
}
