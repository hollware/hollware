import { hollwareBinding, hollwareLiveLoader } from '@hollware/astro'
import { defineLiveCollection } from 'astro/content/config'
import { env } from 'cloudflare:workers'

// The blog of the playground, read at request time over the service binding HOLLWARE of
// wrangler.jsonc: no network and no token. `site` is the key of the site in the Hollware config.
const blog = defineLiveCollection({
  loader: hollwareLiveLoader({
    site: 'playground',
    collection: 'blog',
    locale: 'en',
    reader: () => hollwareBinding(env.HOLLWARE),
  }),
})

export const collections = { blog }
