export interface Enrollment {
  readonly admin: (path: string, body?: unknown) => Promise<unknown>
  readonly create: (options: unknown) => Promise<unknown>
}

function field(value: unknown, name: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, name) : undefined
}

export async function enrollPasskey(enrollment: Enrollment, label: string): Promise<string> {
  const asked = await enrollment.admin('account/passkeys/options', {})
  const response = await enrollment.create(field(asked, 'options'))
  const added = await enrollment.admin('account/passkeys/verify', {
    challengeId: field(asked, 'challengeId'),
    response,
    label: label.trim(),
  })
  const id = field(added, 'id')
  return typeof id === 'string' ? id : ''
}

export function canRemoveLast(passkeys: number, identities: number): boolean {
  return passkeys > 1 || identities > 0
}
