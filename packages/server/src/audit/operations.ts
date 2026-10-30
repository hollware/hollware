import {
  OPERATION_AUDIT_ACTIONS,
  type AuditAction,
  type AuditOutcome,
  type Operation,
} from '@hollware/core'
import type { AuditLine } from './log.ts'

const NAMING_FIELDS = [
  'site',
  'collection',
  'locale',
  'slug',
  'id',
  'entryId',
  'reviewId',
  'name',
  'filename',
  'revision',
]
const FIELD_MAX = 200

function isAudited(name: string): name is AuditAction {
  return (OPERATION_AUDIT_ACTIONS as readonly string[]).includes(name)
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null
    ? Object.fromEntries(Object.entries(value))
    : {}
}

function idOf(value: unknown): string | null {
  const id = record(value)['id']
  return typeof id === 'string' ? id : null
}

function targetOf(
  output: Readonly<Record<string, unknown>>,
  site: string,
): { readonly type: string; readonly id: string } {
  const entry = idOf(output['entry'])
  if (entry !== null) return { type: 'entry', id: entry }
  const review = idOf(output['review'])
  if (review !== null) return { type: 'review', id: review }
  const comment = idOf(output['comment'])
  if (comment !== null) return { type: 'comment', id: comment }
  const asset = idOf(output['asset'])
  if (asset !== null) return { type: 'asset', id: asset }
  return { type: 'site', id: site }
}

export function outcomeOfError(code: string): AuditOutcome {
  return code === 'insufficient_scope' ? 'denied' : 'failed'
}

export function operationLine(
  spec: Operation,
  input: unknown,
  site: string,
  result: { readonly output: unknown } | { readonly errorCode: string },
): AuditLine | null {
  if (!isAudited(spec.name)) return null
  const named: Record<string, string> = {}
  const given = record(input)
  for (const field of NAMING_FIELDS) {
    const value = given[field]
    if (typeof value === 'string') named[field] = value.slice(0, FIELD_MAX)
  }
  if ('errorCode' in result) {
    return {
      action: spec.name,
      outcome: outcomeOfError(result.errorCode),
      errorCode: result.errorCode,
      target: { type: 'site', id: site },
      detail: Object.keys(named).length === 0 ? null : { input: named },
    }
  }
  const output = record(result.output)
  const answer = output['outcome']
  return {
    action: spec.name,
    outcome: 'ok',
    target: targetOf(output, site),
    detail: {
      ...(typeof answer === 'string' ? { answer } : {}),
      ...(Object.keys(named).length === 0 ? {} : { input: named }),
      ...(given['override'] === true ? { override: true } : {}),
    },
  }
}
