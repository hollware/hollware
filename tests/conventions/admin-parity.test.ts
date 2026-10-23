import { describe, expect, it } from 'vite-plus/test'

import { OPERATIONS } from '../../packages/core/src/operations/index.ts'
import { checkAdminParity } from '../guards/admin-parity.ts'
import { exceptionValues, OPERATIONS_WITHOUT_ADMIN } from '../guards/exceptions.ts'
import { describeViolations } from '../guards/types.ts'
import { file } from '../support/fixtures.ts'
import { readRepoFiles } from '../support/repo.ts'

describe('admin parity', () => {
  it('every operation an agent has over MCP, a person has in the admin', () => {
    const violations = checkAdminParity({
      operations: OPERATIONS.map((operation) => operation.name),
      admin: readRepoFiles(
        (path) => path.startsWith('packages/admin/app/') && /\.(ts|vue)$/.test(path),
      ),
      exceptions: exceptionValues(OPERATIONS_WITHOUT_ADMIN),
    })
    expect(describeViolations(violations)).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    const admin = [file('Page.vue', "await api.call('publish', { id })\napi.call( 'search', {})")]

    it('accepts operations the admin calls, or that the list explains', () => {
      expect(
        checkAdminParity({
          operations: ['publish', 'search', 'get_asset'],
          admin,
          exceptions: ['get_asset'],
        }),
      ).toEqual([])
    })

    it('reports an operation no page calls, and an exception that is stale or unknown', () => {
      expect(
        describeViolations(
          checkAdminParity({
            operations: ['publish', 'search', 'restore_revision'],
            admin,
            exceptions: ['search', 'reparse'],
          }),
        ),
      ).toEqual([
        'packages/admin: [admin-parity/missing] no page of the admin calls restore_revision: give a person a way to do it, or say in OPERATIONS_WITHOUT_ADMIN how they do it there.',
        'tests/guards/exceptions.ts: [admin-parity/stale] OPERATIONS_WITHOUT_ADMIN names search, which the admin calls: remove it.',
        'tests/guards/exceptions.ts: [admin-parity/unknown] OPERATIONS_WITHOUT_ADMIN names reparse, which is no operation: remove it.',
      ])
    })
  })
})
