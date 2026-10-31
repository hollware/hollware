import type { OperationName } from '@hollware/core'
import type { EntryKey } from '@pinia/colada'
import type { Input } from './api.ts'
import { api } from './session.ts'

export function operation<Name extends OperationName>(name: Name, input: Input<Name>) {
  return {
    key: ['op', name, input as EntryKey[number]] as const,
    query: ({ signal }: { signal: AbortSignal }) => api.call(name, input, signal),
  }
}

export function admin<Answer>(path: string) {
  return {
    key: ['admin', path] as const,
    query: ({ signal }: { signal: AbortSignal }) => api.admin<Answer>(path, undefined, signal),
  }
}
