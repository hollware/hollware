# @hollware/astro

Read [Hollware](https://hollware.com) from an Astro site: content loaders for Astro's content
layer, over a service binding when the site is a Worker on the same Cloudflare account, or over
HTTP with a read token anywhere else. Published content only, and the latest revision of one entry
when a page is opened with a preview token (live collections).

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
reaches the browser.

## Previews

"Preview on the site" in the admin opens the entry's page with `?hollware-preview=<token>`: a
signed link for one entry, valid for one hour. `hollwarePreview()`, a middleware, exchanges the link
for a cookie: a `303` to the same URL without the parameter (other parameters kept), with the token
in `hollware_preview` (`HttpOnly`, `SameSite=Lax`, `Path=/`, an hour, and `Secure` on every request
but `http://localhost` and `http://127.0.0.1`). The token is in a URL once, but for the first
request's line in the logs; a value not shaped like a token sets no cookie. Every later request
finds the token in `Astro.locals.hollwarePreview`, and its response is `no-store`:

```ts
// src/middleware.ts
import { hollwarePreview } from '@hollware/astro'
export const onRequest = hollwarePreview()
```

```ts
// src/env.d.ts
import type { HollwarePreviewLocals } from '@hollware/astro'

declare global {
  namespace App {
    interface Locals extends HollwarePreviewLocals {}
  }
}
```

A live collection reads the latest revision of the entry, a draft included, when `getLiveEntry`
gets the token in its filter:

```astro
---
import { refusePreview } from '@hollware/astro'
const preview = Astro.locals.hollwarePreview
const { entry, error } = await getLiveEntry('blog', { id: Astro.params.slug!, preview })
if (error) refusePreview(Astro.locals, error)
---
```

A token that is expired, forged or for another entry is an `error`, never the published version.
`refusePreview` makes the response clear the cookie when Hollware says the token expired or is not
valid; a token for another entry is answered as no entry and keeps it.
The build-time `hollwareLoader` has no preview: a static page is built once, for everyone, so it
only ever holds published content.

## Links

- Docs: <https://hollware.com>
- Repository: <https://github.com/hollware/hollware>
- Issues: <https://github.com/hollware/hollware/issues>
- License: MIT
