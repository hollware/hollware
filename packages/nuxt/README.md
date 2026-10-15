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

Every page carries `<meta name="generator" content="Hollware">`; set `hollware.generator: false`
to leave it out.

## Links

- Docs: <https://hollware.com>
- Repository: <https://github.com/hollware/hollware>
- Issues: <https://github.com/hollware/hollware/issues>
- License: MIT
