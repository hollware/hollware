import { uploadAsset } from '@hollware/core'
import { describe, expect, it } from 'vite-plus/test'

import { operationLine } from '../../src/audit/operations.ts'

// Fails when: the line of an upload stops naming the asset it made as its target, and names the
// site instead (src/audit/operations.ts `targetOf`), so the activity log loses which image an
// agent or a person sent (ADR-037, ADR-038).

describe('the line of an operation', () => {
  it('names the asset an upload made as its target, with the answer and its file name', () => {
    const line = operationLine(uploadAsset, { filename: 'stage.png', alt: 'The stage' }, 'blog', {
      output: { outcome: 'created', asset: { id: 'ast_0123456789abcdef0123456789' } },
    })

    expect([line?.target, line?.detail]).toEqual([
      { type: 'asset', id: 'ast_0123456789abcdef0123456789' },
      // The file name names it; the alt, which may be long prose, stays out.
      { answer: 'created', input: { filename: 'stage.png' } },
    ])
  })
})
