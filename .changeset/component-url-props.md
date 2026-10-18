---
'@hollware/core': patch
---

The Markdown pipeline (version 2) checks the props of components that a site binds to links or images by their name (`to`, `url`, `link`, and names ending in `href`, `url` or `src`) as URLs: `::cta{to="javascript:…"}` loses the prop and the verdict says why.
