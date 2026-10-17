---
'@hollware/astro': minor
---

A new package: content loaders that read Hollware from an Astro site. `hollwareLoader` fills a content collection at build time, over HTTP with a read token, and `hollwareLiveLoader` reads at request time, over a service binding. Each entry is a published one: its id is the slug, its data the frontmatter and its rendered HTML the one Hollware made, so Astro's `render(entry)` works.
