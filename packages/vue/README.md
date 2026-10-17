# @hollware/vue

Read [Hollware](https://hollware.com) from a Vue 3 app that is not Nuxt (for Nuxt, use
`@hollware/nuxt`): `<HollwareContent>` renders an entry's Comark document with your own Vue
components, on the server and in the browser, and composables read published content from a
browser-only app. It imports nothing of Cloudflare.

```sh
npm install @hollware/vue
```

## A browser-only app (a Vite SPA)

The composables read over HTTP with a **read token** (`hw_read_`, from `hollware token create --read`).
The token is in the page, so anyone can read it: it can only read published content, and nothing
else. Hollware accepts it from a page whose origin is in the site's `cors.origins`, so add the
origin of the app there (`http://localhost:5173` in development).

```ts
// main.ts
import { createHollwarePlugin } from '@hollware/vue'
createApp(App)
  .use(
    createHollwarePlugin({ site: 'my-site', url: 'https://cms.example.com', token: 'hw_read_…' }),
  )
  .mount('#app')
```

```vue
<script setup lang="ts">
import { HollwareContent, useHollwareEntry } from '@hollware/vue'
const props = defineProps<{ slug: string }>()
const { data, error, pending } = useHollwareEntry('blog', 'en', () => props.slug)
</script>
<template>
  <p v-if="pending">Loading…</p>
  <p v-else-if="error">{{ error.message }}</p>
  <HollwareContent v-else-if="data" :entry="data" :components="{ callout: Callout }" />
  <p v-else>Not found</p>
</template>
```

| What                                         | Does                                                                                                |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `createHollwarePlugin({ site, url, token })` | The plugin that provides Hollware to the app; `provideHollware(app, options)` is the same           |
| `useHollwareEntry(collection, locale, slug)` | `{ data, error, pending }` for one published entry; each argument may be a ref or a getter          |
| `useHollwareEntries(collection, options?)`   | `{ data, error, pending }` for a page of entries, newest first (`locale`, `tag`, `limit`, `cursor`) |

`data` is `undefined` while the first read loads and when the entry is not published (then
`pending` is `false` and `error` is `undefined`). A read that fails sets `error` and clears `data`.
When an argument changes, the composable reads again, keeps the previous `data` meanwhile, and
drops the answer of a read that a newer one replaced.

There is **no preview in the browser**: "Preview on the site" exchanges its link for a cookie that is
`HttpOnly` on the site's server, so a page in the browser never holds the token. Previews need a
server that renders the page.

## A server that renders Vue (Vue SSR with Vite, Vike, any server)

The server helpers are the same as `@hollware/react`'s: they are `@hollware/client`'s, re-exported.

```ts
import { createHollware, previewHeaders, previewRedirect } from '@hollware/vue'
const hollware = createHollware({ site: 'my-site', url: HOLLWARE_URL, token: HOLLWARE_TOKEN })
const redirect = previewRedirect(request) // the 303 that exchanges a preview link, or null
const answer = await hollware.getEntry('blog', 'en', slug, { request }) // { entry, preview } | undefined
const headers = previewHeaders(request) // `no-store` for a visitor who previews
```

Render `answer.entry` with `<HollwareContent :entry="answer.entry" />` and send the same entry to the
browser to hydrate. `createHollware({ site, reader: () => hollwareBinding(env.HOLLWARE) })` reads over
a Cloudflare service binding instead. See the README of `@hollware/react` for `listEntries`,
`getTranslations` and the previews in full: they work the same.

## Components

`<HollwareContent :entry :components>` renders the Comark document Hollware stored when the entry
was written, with `@comark/vue`. `components` maps the names of the components in the entry
(`::callout` is `callout`) to your own Vue components; an element with no mapping renders as the
plain tag. The page needs no Markdown parser: the document is already parsed.
