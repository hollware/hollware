import { describe, expect, it } from 'vite-plus/test'

import { kvMemory, mapMemory } from '../src/memory.ts'
import { capped, DailyLimitReached, textOf, workersAiModel } from '../src/model.ts'

// Fails when: the model of the agents (src/model.ts) stops counting its calls of the day and
// refusing the one over the limit, starting again the next day; stops reading the text of the
// answers of Workers AI in both of their shapes; stops sending the conversation to the model it
// names, through the gateway when one is given; or the KV memory keeps a value for less than the
// 60 seconds KV allows.

describe('the daily limit', () => {
  it('refuses the call over the limit, and allows again the next day', async () => {
    const memory = mapMemory()
    let day = '2026-10-15'
    const model = capped(
      async () => 'ok',
      memory,
      2,
      () => day,
    )
    const ask = () => model([{ role: 'user', content: 'hi' }])

    const answers = [await ask(), await ask(), await ask().catch((error: unknown) => error)]
    day = '2026-10-16'
    const nextDay = await ask()

    expect(answers.slice(0, 2)).toEqual(['ok', 'ok'])
    expect(answers[2]).toBeInstanceOf(DailyLimitReached)
    expect(nextDay).toBe('ok')
    expect(memory.values.get('usage:2026-10-15')).toBe('2')
  })
})

describe('Workers AI', () => {
  it('reads the text of both shapes of answer, and nothing else', () => {
    expect(textOf({ response: 'a' })).toBe('a')
    expect(textOf({ choices: [{ message: { content: 'b' } }] })).toBe('b')
    expect(textOf({ usage: {} })).toBeNull()
  })

  it('sends the conversation to the model, through the gateway when given', async () => {
    const runs: unknown[] = []
    const ai = {
      async run(model: string, input: object, options?: object) {
        runs.push({ model, input, options })
        return { response: 'done' }
      },
    }

    await workersAiModel(ai, '@cf/x/model', { gateway: 'gw' })([{ role: 'user', content: 'hi' }])

    expect(runs).toEqual([
      {
        model: '@cf/x/model',
        input: { messages: [{ role: 'user', content: 'hi' }], max_tokens: 4096 },
        options: { gateway: { id: 'gw' } },
      },
    ])
  })
})

describe('the KV memory', () => {
  it('keeps a value at least the 60 seconds KV allows', async () => {
    const puts: unknown[] = []
    const memory = kvMemory({
      get: async () => null,
      put: async (key, value, options) => {
        puts.push({ key, value, options })
      },
    })

    await memory.put('a', '1', 10)
    await memory.put('b', '2')

    expect(puts).toEqual([
      { key: 'a', value: '1', options: { expirationTtl: 60 } },
      { key: 'b', value: '2', options: undefined },
    ])
  })
})
