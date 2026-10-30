import { approveReview, uploadAsset } from '@hollware/core'
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

  it('keeps that an owner approved a review without the agents it waited for', () => {
    const review = { id: 'rvw_01J9ZQ3X5V7K2M4N6P8R0T1W3Y' }
    const overridden = operationLine(approveReview, { ...review, override: true }, 'blog', {
      output: { outcome: 'published', review },
    })
    const plain = operationLine(approveReview, { ...review, override: false }, 'blog', {
      output: { outcome: 'published', review },
    })

    expect([overridden?.detail, plain?.detail]).toEqual([
      { answer: 'published', input: review, override: true },
      { answer: 'published', input: review },
    ])
  })
})
