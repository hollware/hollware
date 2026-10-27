import { OPERATIONS } from '@hollware/core'
import { describe, expect, it } from 'vite-plus/test'

import { INSTRUCTIONS } from '../../src/mcp/instructions.ts'
import { endpointWith, rpc } from './support.ts'

describe('the instructions of the server', () => {
  it('reach a client of either era when it starts', async () => {
    const { endpoint } = endpointWith()

    const legacy = await rpc(endpoint, 'legacy', 'initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'raw-client', version: '0.0.0' },
    })
    const modern = await rpc(endpoint, 'modern', 'server/discover')

    const text = String(legacy.result.instructions)
    expect(text.split('\n')[0]).toBe(
      'Hollware is the CMS of a site, and you write its content in Markdown.',
    )
    expect(modern.result.instructions).toBe(text)
  })

  it('name only the tools the server has and the outcomes they answer', () => {
    const known = new Set(
      OPERATIONS.flatMap((operation) => [operation.name, ...Object.keys(operation.outcomes)]),
    )

    const named = INSTRUCTIONS.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? []

    expect(named.filter((name) => !known.has(name))).toEqual([])
    expect([...new Set(named)]).toEqual([
      'describe_site',
      'create_draft',
      'update_draft',
      'get_entry',
      'needs_acknowledgement',
      'pending_review',
      'upload_asset',
      'list_entries',
    ])
  })
})
