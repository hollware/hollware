---
'hollware': minor
---

`hollware import --from notion` takes `--sections headings`, for a root that groups its pages under headings rather than under pages: each page below the root takes the heading above it on the root as its section, a heading inside a callout or a column too, and in a nested collection only those pages carry it. `--skip-root` imports the pages below the root and not the root itself, and points a link to the root at the route of the collection without a slug.
