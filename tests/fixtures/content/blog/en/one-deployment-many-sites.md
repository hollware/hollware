---
title: One deployment, many sites
description: How one deployment keeps the content of each of its sites apart.
date: 2026-09-22
tags:
  - cloudflare
  - cms
translationGroup: site-isolation
---

# One deployment, many sites

How one deployment keeps the content of each of its sites apart. This post is part of the synthetic corpus of the tests, so its words only need to read like a post.

## Why it matters

A site that publishes often needs **fast reads** and _predictable_ writes. Read [the post about from draft to published](/en/blog/from-draft-to-published/) for the related part of the story.

::callout{type="tip"}
Keep the slug short: it becomes part of the public path.
::

## How it works

1. The writer saves a draft.
2. The contracts check it and return a verdict.
3. A publish makes the page public.

```ts
const verdict = await validate(markdown)
```

![A diagram of the flow](/images/one-deployment-many-sites.png)
