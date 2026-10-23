import { describe, expect, it } from 'vite-plus/test'
import { breakingChanges, onlyAddsOptional } from './api-compat.ts'

const tool = (input: object, output: object, scopes = ['content:read']) => ({
  'mcp.json': { tools: [{ name: 'get_entry', scopes, input, output }] },
})
const object = (properties: object, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
})
const outcomes = (...values: string[]) => ({
  anyOf: values.map((outcome) =>
    object({ outcome: { type: 'string', const: outcome }, id: { type: 'string' } }, [
      'outcome',
      'id',
    ]),
  ),
})

describe('an RPC signature that gains options', () => {
  const was =
    'search( site: string, options?: { readonly limit?: number readonly mode?: Mode }): Promise<X>'

  it('fits a minor version when it only gains optional members', () => {
    expect(
      onlyAddsOptional(
        was,
        'search( site: string, options?: { readonly limit?: number readonly mode?: Mode readonly passages?: boolean readonly minScore?: number }): Promise<X>',
      ),
    ).toBe(true)
  })

  it('breaks when a member becomes required, changes its type, or goes', () => {
    expect([
      onlyAddsOptional(
        was,
        'search( site: string, options?: { readonly limit?: number readonly mode?: Mode readonly passages: boolean }): Promise<X>',
      ),
      onlyAddsOptional(
        was,
        'search( site: string, options?: { readonly limit?: string readonly mode?: Mode }): Promise<X>',
      ),
      onlyAddsOptional(
        was,
        'search( site: string, options?: { readonly mode?: Mode }): Promise<X>',
      ),
    ]).toEqual([false, false, false])
  })
})

describe('breakingChanges', () => {
  it('finds none between a version and itself, nor in what a minor version may add', () => {
    const before = tool(object({ slug: { type: 'string' } }, ['slug']), outcomes('ok'))
    const after = {
      'mcp.json': {
        tools: [
          {
            name: 'get_entry',
            scopes: ['content:read'],
            input: object({ slug: { type: 'string' }, locale: { type: 'string' } }, ['slug']),
            output: outcomes('ok', 'not_found'),
          },
          { name: 'new_tool', scopes: ['content:write'], input: object({}), output: object({}) },
        ],
      },
      'exports.json': { '@hollware/core': { '.': { added: 'value' } } },
    }
    expect(breakingChanges(before, before)).toEqual([])
    expect(breakingChanges(before, after)).toEqual([])
  })

  it('reports an input that gets stricter, and an answer that loses what it sent', () => {
    const before = tool(
      object({ slug: { type: 'string' }, view: { type: 'string', enum: ['head', 'published'] } }, [
        'slug',
      ]),
      object(
        {
          outcome: { type: 'string' },
          id: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        ['outcome', 'id'],
      ),
    )
    const after = tool(
      object(
        {
          slug: { type: 'string' },
          view: { type: 'string', enum: ['head'] },
          locale: { type: 'string' },
        },
        ['slug', 'locale'],
      ),
      object({ outcome: { type: 'string' }, id: { type: ['string', 'null'] } }, ['outcome']),
      ['content:read', 'content:write'],
    )

    expect(breakingChanges(before, after)).toEqual([
      'mcp get_entry: now asks for content:write',
      'mcp get_entry input.locale: is now required',
      'mcp get_entry input.view: no longer takes "published"',
      'mcp get_entry output.tags: is no longer sent',
      'mcp get_entry output.id: may now be missing',
      'mcp get_entry output.id: may now be null',
    ])
  })

  it('reports what goes: a tool, a path, an RPC method, a flag, an export, an event kind, a migration', () => {
    const before = {
      'mcp.json': { tools: [{ name: 'publish', scopes: [], input: {}, output: {} }] },
      'http.json': { paths: { '/v1/site': { get: { responses: {} } } } },
      'rpc.json': { describeSite: 'describeSite(site: string)', search: 'search(q: string)' },
      'cli.json': {
        commands: ['init', 'export'],
        flags: { init: [{ site: { type: 'string' }, local: { type: 'boolean' } }] },
      },
      'exports.json': { '@hollware/core': { '.': { verifyWebhook: 'value', Shape: 'type' } } },
      'events.json': {
        oneOf: [
          object({ kind: { type: 'string', const: 'entry.published' } }),
          object({ kind: { type: 'string', const: 'site.changed' } }),
        ],
      },
      'migrations.json': { '0001_core.sql': 'aaa', '0002_append_only.sql': 'bbb' },
    }
    const after = {
      'mcp.json': { tools: [] },
      'http.json': { paths: {} },
      'rpc.json': { describeSite: 'describeSite(site: string, options?: object)' },
      'cli.json': { commands: ['init'], flags: { init: [{ site: { type: 'string' } }] } },
      'exports.json': { '@hollware/core': { '.': { verifyWebhook: 'type' } } },
      'events.json': { oneOf: [object({ kind: { type: 'string', const: 'entry.published' } })] },
      'migrations.json': { '0001_core.sql': 'aaa', '0002_append_only.sql': 'ccc' },
    }

    expect(breakingChanges(before, after)).toEqual([
      'mcp publish: the tool is gone',
      'http GET /v1/site: is gone',
      'event: kind=site.changed is no longer sent',
      'rpc describeSite: its signature changed, from describeSite(site: string) to describeSite(site: string, options?: object)',
      'rpc search: is gone',
      'cli export: the command is gone',
      'cli init --local: the flag is gone',
      'exports @hollware/core . verifyWebhook: is a type now, no longer a value',
      'exports @hollware/core . Shape: is gone',
      'migration 0002_append_only.sql: it changed after it was published',
    ])
  })
})
