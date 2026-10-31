---
'hollware': minor
---

`hollware import --from nuxt-content --public-dir <dir>` uploads the images the pages show by path, `/blog/x.webp` from that folder and `./x.webp` from the folder of the page, in the Markdown or as a value of the frontmatter, once each however many pages show them, and writes `asset:ast_…` in their place. A missing image, or one over 10 MB, stops the import before anything is sent, with how to fix it.
