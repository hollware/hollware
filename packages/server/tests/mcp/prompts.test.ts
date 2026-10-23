import { describe, expect, it } from 'vite-plus/test'

import { connect, endpointWith } from './support.ts'

const STEPS = ['content_stats', 'get_entry', 'search', 'update_draft', 'publish'] as const

function order(text: string): number[] {
  return STEPS.map((tool) => text.indexOf(tool))
}

describe('the prompt refresh_content', () => {
  it.each(['2026', '2025'] as const)(
    'is listed to a %s client, with its optional days',
    async (era) => {
      const { client } = await connect(endpointWith().endpoint, { era })

      const { prompts } = await client.listPrompts()

      expect(prompts.map(({ name, title, arguments: args }) => ({ name, title, args }))).toEqual([
        {
          name: 'refresh_content',
          title: 'Refresh what readers read',
          args: [
            {
              name: 'days',
              description: 'How many days of reading to look at, 1 to 90; 30 when not given.',
              required: false,
            },
          ],
        },
      ])
      await client.close()
    },
  )

  it('walks through the tools in order, over the days it is given', async () => {
    const { client } = await connect(endpointWith().endpoint, { era: '2026' })

    const given = await client.getPrompt({ name: 'refresh_content', arguments: { days: '7' } })
    const plain = await client.getPrompt({ name: 'refresh_content' })

    const textOf = (result: typeof given) => {
      const content = result.messages[0]?.content
      return content?.type === 'text' ? content.text : ''
    }
    expect(textOf(given)).toContain('Call content_stats with days: 7.')
    expect(textOf(plain)).toContain('Call content_stats with days: 30.')
    expect(textOf(given)).toContain('with related: true')
    const positions = order(textOf(given))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    await client.close()
  })
})
