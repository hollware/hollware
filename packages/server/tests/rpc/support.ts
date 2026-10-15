import type { HollwareRpc } from '../../src/index.ts'
import { CANNED } from '../mcp/support.ts'
import { SITE_KEY } from '../http/support.ts'

/** What a call is built from: the method, the operation that answers it, and an example. */
export const CALLS = [
  {
    method: 'getEntry',
    tool: 'get_entry',
    call: (rpc: HollwareRpc) => rpc.getEntry(SITE_KEY, 'blog', 'hello-world', 'en'),
    input: {
      collection: 'blog',
      locale: 'en',
      slug: 'hello-world',
      formats: ['markdown'],
      published: false,
    },
    output: CANNED.get_entry.ok,
  },
  {
    method: 'listEntries',
    tool: 'list_entries',
    call: (rpc: HollwareRpc) => rpc.listEntries(SITE_KEY, 'blog'),
    input: { collection: 'blog', limit: 20 },
    output: CANNED.list_entries.ok,
  },
  {
    method: 'getTranslations',
    tool: 'get_translations',
    call: (rpc: HollwareRpc) => rpc.getTranslations(SITE_KEY, 'blog', 'edge-caching'),
    input: { collection: 'blog', translationGroup: 'edge-caching' },
    output: CANNED.get_translations.ok,
  },
  {
    method: 'describeSite',
    tool: 'describe_site',
    call: (rpc: HollwareRpc) => rpc.describeSite(SITE_KEY),
    input: {},
    output: CANNED.describe_site.ok,
  },
] as const
