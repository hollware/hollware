import { FORMER_PERSON } from '@hollware/core'

export function personName(id: string, name: string | null, former: string): string {
  return id === FORMER_PERSON ? former : (name ?? id)
}
