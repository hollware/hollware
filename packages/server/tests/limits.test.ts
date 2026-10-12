import { describe, expect, it } from 'vite-plus/test'

import {
  MAX_BOUND_PARAMETERS,
  MAX_ROW_BYTES,
  OPERATION_TIMEOUT_MS,
  OUTPUT_CAP_BYTES,
} from '../src/limits.ts'

// Fails when: a limit of the operations moves away from the v0.1 plan, or the store's limits stop
// leaving room under D1's own (2 MB per row, 100 bound parameters per statement).

describe('operation limits', () => {
  it('are the ones of the v0.1 plan, under the limits of D1', () => {
    expect({ OUTPUT_CAP_BYTES, OPERATION_TIMEOUT_MS, MAX_ROW_BYTES, MAX_BOUND_PARAMETERS }).toEqual(
      {
        OUTPUT_CAP_BYTES: 1_048_576,
        OPERATION_TIMEOUT_MS: 10_000,
        MAX_ROW_BYTES: 1_900_000,
        MAX_BOUND_PARAMETERS: 90,
      },
    )
    expect(MAX_ROW_BYTES).toBeLessThan(2_000_000)
    expect(MAX_BOUND_PARAMETERS).toBeLessThan(100)
  })
})
