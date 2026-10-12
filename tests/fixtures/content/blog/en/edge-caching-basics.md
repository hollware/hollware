---
title: Edge caching basics
description: What an edge cache keeps, for how long, and how a publish clears it.
date: 2026-09-01
tags:
  - cloudflare
  - cms
translationGroup: edge-caching
---

# Edge caching basics

What an edge cache keeps, for how long, and how a publish clears it. This post is part of the synthetic corpus of the tests, so its words only need to read like a post.

## Why it matters

A site that publishes often needs **fast reads** and _predictable_ writes. Read [the post about agents write with contracts](/en/blog/agents-write-with-contracts/) for the related part of the story.

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

![A diagram of the flow](/images/edge-caching-basics.png)
