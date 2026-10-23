# @hollware/astro

The Astro content loaders of Hollware. Boundary rules for this package:

- Reads only: it reaches Hollware through `@hollware/client` (`HollwareReader`), never MCP, and
  what it reads is published content.
- It ships no component, route or browser code, so a token never reaches the browser: the loaders
  run on the server (the build, or a request) and the site hands the page only what it renders.
- An entry's id is its slug in the locale it was given, its data the frontmatter, and its
  rendered HTML that Hollware made: the loaders never render Markdown themselves.
- It imports Astro as types only, and nothing of Cloudflare: a live loader gets its service
  binding through a function the site writes (`() => env.HOLLWARE`).
- Drafts are left out, but for one case: a live loader's `loadEntry` takes `{ id, preview }` and
  reads the latest revision of the entry a preview token names. The token reaches the page through
  `hollwarePreview()` (`src/preview.ts`), a middleware that exchanges `?hollware-preview=<token>`
  for the `hollware_preview` cookie with a `303`, puts the token on `Astro.locals`, and answers
  every request that has one `no-store`; `refusePreview` clears the cookie for a token Hollware
  says expired or is invalid, never for another entry's. The shape, the cookie and the URL without
  the parameter are pure functions of `@hollware/client`. A previewed entry carries no
  `cacheHint`. The build-time `hollwareLoader` has no preview: it is static, and holds published
  content only.
- `examples/astro-blog` is its proof: `apps/playground/test/harness/astro-site.test.ts` builds it
  and reads the playground over the service binding.
- A site that reads only Hollware sets `session: false` and `imageService: 'passthrough'`
  (`examples/astro-blog/astro.config.ts`): otherwise `@astrojs/cloudflare` binds a KV namespace and Images.
