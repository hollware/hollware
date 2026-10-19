---
'@hollware/core': minor
'@hollware/server': minor
'@hollware/client': minor
'@hollware/react': minor
'@hollware/vue': minor
'@hollware/nuxt': minor
'@hollware/astro': minor
---

Components to render entries in every framework:

- `<HollwareImage>` in React, Vue and Nuxt renders the image a frontmatter field holds (a cover) with its alt, its size and the `srcset` of its copies; `imageOf(entry, field)` of `@hollware/client` gives the same attributes for any other renderer. The `images` of a summary carry the alt of each image.
- `@hollware/astro` exports `HollwareContent.astro`, which renders an entry from its document with the site's own Astro components (`components={{ callout: Callout }}`), through the same rules as the HTML Hollware makes, and `HollwareImage.astro`. Its loaders keep the document and the images of each entry for them.
- `safeDocument` of `@hollware/core` copies a document through the rules of `renderHtml`, for a renderer of a site's own.
