import { describe, expect, it } from 'vite-plus/test'

import {
  AUDIT_ACTIONS,
  IDENTITY_AUDIT_ACTIONS,
  isAuditAction,
  OPERATION_AUDIT_ACTIONS,
} from '../../src/audit/index.ts'
import { OPERATIONS } from '../../src/operations/index.ts'

describe('the actions of the activity log', () => {
  it('name every operation that is not a read, and no read', () => {
    const writes = OPERATIONS.filter((operation) => operation.effect !== 'read').map(
      (operation) => operation.name,
    )

    expect([...OPERATION_AUDIT_ACTIONS].sort()).toEqual(writes.sort())
  })

  it('name each action once, and only those', () => {
    expect(new Set(AUDIT_ACTIONS).size).toBe(
      OPERATION_AUDIT_ACTIONS.length + IDENTITY_AUDIT_ACTIONS.length,
    )
    expect([isAuditAction('token.create'), isAuditAction('get_entry'), isAuditAction('')]).toEqual([
      true,
      false,
      false,
    ])
  })
})
