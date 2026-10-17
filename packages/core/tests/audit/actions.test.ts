import { describe, expect, it } from 'vite-plus/test'

import {
  AUDIT_ACTIONS,
  IDENTITY_AUDIT_ACTIONS,
  isAuditAction,
  OPERATION_AUDIT_ACTIONS,
} from '../../src/audit/index.ts'
import { OPERATIONS } from '../../src/operations/index.ts'

// Fails when: an operation that is not a read is missing from OPERATION_AUDIT_ACTIONS (src/audit),
// so its calls would write no line of the activity log (ADR-037), or a read is listed there; or
// when an action is named twice, or isAuditAction stops refusing a name that is no action.

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
