import { FORMER_PERSON } from '@hollware/core'

export function personName(id: string, name: string | null, former: string): string {
  return id === FORMER_PERSON ? former : (name ?? id)
}

export function invitationBody(
  role: 'editor' | 'author',
  email: string,
): { role: 'editor' | 'author'; email?: string } {
  const address = email.trim()
  return address === '' ? { role } : { role, email: address }
}
