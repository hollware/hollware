# @hollware/nuxt

Read [Hollware](https://hollware.com) from a Nuxt site: over a service binding when the site is a
Worker on the same Cloudflare account, or over HTTP with a read token anywhere else.

```sh
npm install @hollware/nuxt
```

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@hollware/nuxt'],
  hollware: { site: 'my-site' },
  nitro: { preset: 'cloudflare_module', cloudflare: { deployConfig: true, nodeCompat: false } },
})
```

On Cloudflare, bind the Hollware Worker in the site's `wrangler.jsonc`:

```jsonc
"services": [{ "binding": "HOLLWARE", "service": "my-hollware", "entrypoint": "Hollware" }]
```

Elsewhere, set `hollware.url` and a read token (`hollware token create --read`) in
`NUXT_HOLLWARE_TOKEN`. The token stays on the server: pages read through the site's own
`/_hollware/` routes.

```vue
<script setup lang="ts">
const { data } = await useHollwareEntry('blog', 'en', useRoute().params.slug as string)
</script>

<template>
  <h1>{{ data?.entry.frontmatter.title }}</h1>
  <HollwareContent :entry="data?.entry" />
</template>
```

| What                                            | Does                                                 |
| ----------------------------------------------- | ---------------------------------------------------- |
| `useHollwareEntry(collection, locale, slug)`    | A published entry with its Comark document, or a 404 |
| `useHollwareEntries(collection, { locale, … })` | A page of published entries, newest first            |
| `useHollwareTranslations(collection, group)`    | The entries of a translation group                   |
| `useHollwareSite()`                             | The site: its locales and collections                |
| `<HollwareContent :entry :components>`          | Renders the document with `@comark/vue`              |
| `useHollware(event)` (server)                   | The reader itself, for routes of your own            |
| `useHollwareTags(tags)`, `hollwareTags`         | The cache tags of what a route of your own read      |

Each composable takes `{ lazy, server }` last, as `useFetch` does: with `server: false`, a
prerendered page reads in the browser only.

A route of your own that reads through `useHollware(event).reader` tags its own answer. A page
that reads that route gives the page the same tags, so `cache: 'purge'` keeps and purges it:

```ts
const { data } = await useFetch('/api/jobs')
useHollwareTags(hollwareTags.list('jobs', 'es', data.value?.entries ?? []))
```

Every page carries `<meta name="generator" content="Hollware">`; set `hollware.generator: false`
to leave it out.

## Previews

"Preview on the site" in the admin opens the entry's page with `?hollware-preview=<token>`, a
signed link for one entry that works for one hour. The module answers that request with a `303` to
the same URL without the parameter (other parameters kept) and keeps the token in the
`hollware_preview` cookie: `HttpOnly`, `SameSite=Lax`, `Path=/`, an hour, and `Secure` on every
request but `http://localhost` and `http://127.0.0.1`, so local development works. The token is in
a URL once: not in the address bar, the history, a `Referer` or a copied link, but for the first
request's line in the logs. A value not shaped like a token sets no cookie.

A request with the cookie reads the latest revision of that entry through `useHollwareEntry`, a
draft included, and nothing keeps what it answers: no cache tag, `Cache-Control: no-store`, and the
cache of `hollware.cache` neither serves nor stores it. A token that is expired or not valid is
refused by Hollware: the page is what it is without a token (a 404 for a draft) and the response
clears the cookie. A token for another entry is answered as no entry and keeps the cookie. It needs
the Worker secret `HOLLWARE_SECRET` in Hollware.

The redirect adds `hollware-view=<random>` to the URL: a value of no secret, new for each link, so
the previewed page is at a URL no cache holds, and Workers Cache in front of the site (`cache:
'purge'`) cannot answer it with the published page before the Worker reads the cookie.

## Links

- Docs: <https://hollware.com>
- Repository: <https://github.com/hollware/hollware>
- Issues: <https://github.com/hollware/hollware/issues>
- License: MIT
