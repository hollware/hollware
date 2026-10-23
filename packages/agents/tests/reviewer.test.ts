import { commentReview } from '@hollware/core'
import { describe, expect, it } from 'vite-plus/test'

import type { AllowedTool, Hollware } from '../src/hollware.ts'
import { mapMemory } from '../src/memory.ts'
import { reviewPending } from '../src/reviewer.ts'

function hollwareAnswering(commentOutcome: string) {
  const calls: { tool: AllowedTool; input: Readonly<Record<string, unknown>> }[] = []
  const hollware: Hollware = {
    async call(tool, input) {
      calls.push({ tool, input })
      if (tool === 'describe_site') return { outcome: 'ok', site: { collections: [] } }
      if (tool === 'list_reviews') {
        return {
          outcome: 'ok',
          reviews: [
            {
              id: 'rvw_01JAB3XQ8ZK4M6N2P5R7S9T0VW',
              comments: [],
              entry: { collection: 'blog', locale: 'en', slug: 'a' },
            },
          ],
        }
      }
      if (tool === 'get_entry') return { outcome: 'ok', entry: { markdown: '# A\n' } }
      return { outcome: commentOutcome }
    },
  }
  return { hollware, calls }
}

describe('reviewPending', () => {
  it('clips a long answer to a comment that comment_review accepts', async () => {
    const { hollware, calls } = hollwareAnswering('commented')

    const result = await reviewPending({
      hollware,
      model: async () => 'x'.repeat(5000),
      memory: mapMemory(),
    })

    const comment = calls.find((call) => call.tool === 'comment_review')
    expect(result).toEqual({ commented: 1 })
    expect(String(comment?.input['body'])).toBe(`${'x'.repeat(3500)}…`)
    expect(commentReview.input.safeParse(comment?.input).success).toBe(true)
  })

  it('remembers a review whose comment was refused, and never reads it again', async () => {
    const { hollware, calls } = hollwareAnswering('not_pending')
    const memory = mapMemory()
    const deps = { hollware, model: async () => 'Clear.', memory }

    const first = await reviewPending(deps)
    const before = calls.length
    const second = await reviewPending(deps)

    expect([first, second]).toEqual([{ commented: 0 }, { commented: 0 }])
    expect(memory.values.get('reviewed:rvw_01JAB3XQ8ZK4M6N2P5R7S9T0VW')).toBe('not_pending')
    expect(calls.slice(before).map((call) => call.tool)).toEqual(['describe_site', 'list_reviews'])
  })
})
