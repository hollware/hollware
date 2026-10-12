---
title: From draft to published
description: The steps between a saved draft and a page that readers can open.
date: 2026-09-29
tags:
  - agents
  - markdown
translationGroup: publishing-flow
---

# From draft to published

The steps between a saved draft and a page that readers can open. This post is part of the synthetic corpus of the tests, so its words only need to read like a post.

## Why it matters

A site that publishes often needs **fast reads** and _predictable_ writes. Read [the post about edge caching basics](/en/blog/edge-caching-basics/) for the related part of the story.

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

![A diagram of the flow](/images/from-draft-to-published.png)
