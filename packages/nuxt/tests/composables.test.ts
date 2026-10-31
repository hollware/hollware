import { describe, expect, it, vi } from 'vite-plus/test'

const calls: { path: string; server: unknown; lazy: unknown }[] = []
const page: { context: Record<string, unknown> } = { context: {} }

vi.mock('nuxt/app', () => ({
  useRequestEvent: () => page,
  useFetch: (path: string | { value: string }, options: { server?: unknown; lazy?: unknown }) => {
    calls.push({
      path: typeof path === 'string' ? path : path.value,
      server: options.server,
      lazy: options.lazy,
    })
    return {}
  },
}))

const composables = await import('../src/runtime/composables.ts')
const { tagsOf } = await import('../src/runtime/tags.ts')

describe('the composables of pages', () => {
  it('pass lazy and server to useFetch, so a prerendered page can read only in the browser', async () => {
    const fetching = { server: false, lazy: true }
    await composables.useHollwareEntry('blog', 'en', 'hello', fetching)
    await composables.useHollwareEntries('blog', {}, fetching)
    await composables.useHollwareTranslations('blog', 'hello', fetching)
    await composables.useHollwareNavigation('docs', {}, fetching)
    await composables.useHollwareSite(fetching)

    expect(calls).toEqual([
      { path: '/_hollware/entry/blog/en/hello', server: false, lazy: true },
      { path: '/_hollware/entries/blog', server: false, lazy: true },
      { path: '/_hollware/translations/blog/hello', server: false, lazy: true },
      { path: '/_hollware/navigation/docs', server: false, lazy: true },
      { path: '/_hollware/site', server: false, lazy: true },
    ])
  })

  it('give the page the tags of what a route of its own read, for the edge to purge it', () => {
    const { hollwareTags, useHollwareTags } = composables
    useHollwareTags(hollwareTags.list('jobs', 'es', [{ id: 'ent_1' }, { id: 'ent_2' }]))

    expect(tagsOf(page)).toEqual(['list:jobs:es', 'entry:ent_1', 'entry:ent_2'])
  })
})
