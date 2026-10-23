import { describe, expect, it } from 'vite-plus/test'

import { countOutcomes, runAll } from '../app/lib/bulk.ts'

describe('runAll', () => {
  it('runs every item, at most so many at once, and keeps their order', async () => {
    let running = 0
    let most = 0
    const answers = await runAll(
      [5, 1, 4, 2, 3, 1],
      async (ms) => {
        running++
        most = Math.max(most, running)
        await new Promise((done) => setTimeout(done, ms))
        running--
        return { outcome: `done ${ms}` }
      },
      3,
    )

    expect(most).toBe(3)
    expect(answers.map((result) => ('answer' in result ? result.answer.outcome : 'x'))).toEqual([
      'done 5',
      'done 1',
      'done 4',
      'done 2',
      'done 3',
      'done 1',
    ])
  })

  it('goes on past a row that throws, and keeps what it threw', async () => {
    const boom = new Error('refused')
    const results = await runAll(['a', 'b', 'c'], async (item) => {
      if (item === 'b') throw boom
      return { outcome: 'published' }
    })

    expect(results).toEqual([
      { item: 'a', answer: { outcome: 'published' } },
      { item: 'b', error: boom },
      { item: 'c', answer: { outcome: 'published' } },
    ])
    expect([...countOutcomes(results)]).toEqual([
      ['published', 2],
      ['failed', 1],
    ])
  })
})
