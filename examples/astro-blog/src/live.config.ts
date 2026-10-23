import { hollwareBinding, hollwareLiveLoader } from '@hollware/astro'
import { defineLiveCollection } from 'astro/content/config'
import { env } from 'cloudflare:workers'

const blog = defineLiveCollection({
  loader: hollwareLiveLoader({
    site: 'playground',
    collection: 'blog',
    locale: 'en',
    reader: () => hollwareBinding(env.HOLLWARE),
  }),
})

export const collections = { blog }
