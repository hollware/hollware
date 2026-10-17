# @hollware/astro

Read [Hollware](https://hollware.com) from an Astro site: content loaders for Astro's content
layer, over a service binding when the site is a Worker on the same Cloudflare account, or over
HTTP with a read token anywhere else. Published content only.

```sh
npm install @hollware/astro
```

On Cloudflare, bind the Hollware Worker in the site's `wrangler.jsonc`:

```jsonc
"services": [{ "binding": "HOLLWARE", "service": "my-hollware", "entrypoint": "Hollware" }]
```

A live collection reads at request time, so a publish shows with no rebuild:

```ts
// src/live.config.ts
import { env } from 'cloudflare:workers'
import { defineLiveCollection } from 'astro/content/config'
import { hollwareBinding, hollwareLiveLoader } from '@hollware/astro'

const blog = defineLiveCollection({
  loader: hollwareLiveLoader({
    site: 'my-site',
    collection: 'blog',
    locale: 'en',
    reader: () => hollwareBinding(env.HOLLWARE),
  }),
})
export const collections = { blog }
```

```astro
---
import { getLiveEntry, render } from 'astro:content'
const { entry } = await getLiveEntry('blog', Astro.params.slug!)
const { Content } = await render(entry!)
---
<h1>{entry.data.title}</h1>
<Content />
```

A build-time collection reads over HTTP with a read token (`hollware token create --read`):

```ts
// src/content.config.ts
import { defineCollection } from 'astro:content'
import { hollwareLoader } from '@hollware/astro'

const blog = defineCollection({
  loader: hollwareLoader({
    site: 'my-site',
    collection: 'blog',
    locale: 'en',
    url: 'https://cms.example.com',
    token: process.env.HOLLWARE_TOKEN ?? '',
  }),
})
export const collections = { blog }
```

| What                                   | Does                                                                   |
| -------------------------------------- | ---------------------------------------------------------------------- |
| `hollwareLoader(options)`              | A loader for `defineCollection`: every published entry, with its HTML  |
| `hollwareLiveLoader(options)`          | A loader for `defineLiveCollection`: reads at request time             |
| `hollwareBinding(env.HOLLWARE)`        | The service binding as a reader, with a clear error when it is missing |
| `hollwareTranslations(options, group)` | The `{ locale, slug }` of each entry of a translation group            |

An entry's `id` is its slug, its `data` the frontmatter (give `defineCollection` a `schema` to
validate it) and its rendered HTML the one Hollware made, so `render(entry)` works. The
`locale` option picks the locale; make one collection per locale. `getLiveCollection('blog',
{ tag, limit })` lists the entries without their HTML.

The token stays on the server: the loaders run in the build or in a request, and nothing here
reaches the browser. There is no draft preview yet.

## Links

- Docs: <https://hollware.com>
- Repository: <https://github.com/hollware/hollware>
- Issues: <https://github.com/hollware/hollware/issues>
- License: MIT
