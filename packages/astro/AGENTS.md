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
- Drafts are left out on purpose: `@hollware/nuxt` has no preview either, and a preview needs
  the same design on both (a preview token, and a route that no cache keeps).
- `examples/astro-blog` is its proof: `apps/playground/test/harness/astro-site.test.ts` builds it
  and reads the playground over the service binding.
