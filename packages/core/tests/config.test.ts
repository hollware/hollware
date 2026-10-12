import { describe, expect, expectTypeOf, it } from 'vite-plus/test'
import * as z from 'zod'

import {
  defineCollection,
  defineComponent,
  defineConfig,
  defineContract,
} from '../src/config/define.ts'
import type { Contract } from '../src/contracts/types.ts'

// Fails when: the define helpers stop returning what they are given, or the frontmatter type of
// a collection stops reaching the contracts written inside it, or a shared contract stops fitting
// a collection whose frontmatter has what it reads (type errors under `vp check`).

const hasDescription = defineContract<{ description: string }>({
  id: 'has-description',
  severity: 'error',
  description: 'A description that is not empty.',
  check: ({ frontmatter }) =>
    frontmatter.description === ''
      ? [{ path: '/frontmatter/description', message: 'It is empty.', fix: 'Describe it.' }]
      : [],
})

const blog = defineCollection({
  schema: z.object({ title: z.string(), description: z.string(), tags: z.array(z.string()) }),
  routes: { en: '/blog/:slug/' },
  tags: 'tags',
  components: {
    callout: defineComponent({
      props: z.strictObject({ type: z.enum(['info', 'tip']) }),
      description: 'A highlighted note.',
      example: '::callout{type="tip"}\nUse the cache.\n::',
    }),
  },
  contracts: [
    {
      id: 'title-length',
      severity: 'warning',
      description: 'A title of at most 60 characters.',
      check: ({ frontmatter }) => {
        expectTypeOf(frontmatter).toEqualTypeOf<{
          title: string
          description: string
          tags: string[]
        }>()
        return frontmatter.title.length <= 60
          ? []
          : [{ path: '/frontmatter/title', message: 'The title is long.', fix: 'Shorten it.' }]
      },
    },
    hasDescription,
  ],
})

describe('the define helpers', () => {
  it('return the config as given', () => {
    const sites = { acme: { locales: ['en'], defaultLocale: 'en', collections: { blog } } } as const
    const config = defineConfig({ sites })
    expect(config.sites).toBe(sites)
    expect(config.sites['acme']?.collections['blog']).toBe(blog)
  })

  it('give the contracts of a collection the frontmatter its schema returns', () => {
    expectTypeOf(blog.contracts).toEqualTypeOf<
      readonly Contract<{ title: string; description: string; tags: string[] }>[] | undefined
    >()
    expect(blog.contracts?.map((contract) => contract.id)).toEqual([
      'title-length',
      'has-description',
    ])
  })
})
