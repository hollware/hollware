import { uploadAsset } from '@hollware/core'
import { describe, expect, it } from 'vite-plus/test'

import { operationLine } from '../../src/audit/operations.ts'

describe('the line of an operation', () => {
  it('names the asset an upload made as its target, with the answer and its file name', () => {
    const line = operationLine(uploadAsset, { filename: 'stage.png', alt: 'The stage' }, 'blog', {
      output: { outcome: 'created', asset: { id: 'ast_0123456789abcdef0123456789' } },
    })

    expect([line?.target, line?.detail]).toEqual([
      { type: 'asset', id: 'ast_0123456789abcdef0123456789' },
      { answer: 'created', input: { filename: 'stage.png' } },
    ])
  })
})
