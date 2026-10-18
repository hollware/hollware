import { describe, expect, it } from 'vite-plus/test'

import { RESERVED_COLLECTION_NAMES } from '../../packages/core/src/config/constants.ts'
import { checkReservedCollections } from '../guards/reserved-collections.ts'
import { describeViolations } from '../guards/types.ts'
import { file } from '../support/fixtures.ts'
import { readText } from '../support/repo.ts'

// Fails when: a route of the server takes a segment of /v1/ that RESERVED_COLLECTION_NAMES
// (packages/core/src/config/constants.ts) does not hold, or the list holds one no route takes.

const CONSTANTS = 'packages/core/src/config/constants.ts'
const ROUTES = [
  'packages/server/src/http/read-api.ts',
  'packages/server/src/http/gateway.ts',
  'packages/server/src/http/ops-api.ts',
  'packages/server/src/http/admin-api.ts',
]

describe('reserved collection names', () => {
  it('are the segments of /v1/ that the routes of the server take', () => {
    const violations = checkReservedCollections({
      routes: ROUTES.map((path) => file(path, readText(path))),
      reserved: RESERVED_COLLECTION_NAMES,
      reservedFile: CONSTANTS,
    })
    expect(describeViolations(violations)).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    const routes = [file('api.ts', "app.get('/v1/site', a); app.get(`/v1/ops/${name}`, b)")]

    it('accepts routes whose segments are all reserved, and ignores :collection', () => {
      const withParam = [...routes, file('more.ts', "app.get('/v1/:collection', c)")]
      expect(
        checkReservedCollections({
          routes: withParam,
          reserved: ['ops', 'site'],
          reservedFile: CONSTANTS,
        }),
      ).toEqual([])
    })

    it('reports a route that is not reserved, and a name that no route takes', () => {
      expect(
        describeViolations(
          checkReservedCollections({
            routes,
            reserved: ['site', 'admin'],
            reservedFile: CONSTANTS,
          }),
        ),
      ).toEqual([
        'api.ts: [reserved-collections/unreserved-route] a route takes /v1/ops, which RESERVED_COLLECTION_NAMES does not hold: add "ops" to it.',
        `${CONSTANTS}: [reserved-collections/no-route] RESERVED_COLLECTION_NAMES holds "admin", which no route under /v1/ takes: remove it.`,
      ])
    })
  })
})
