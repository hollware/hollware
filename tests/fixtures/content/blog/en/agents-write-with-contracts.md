---
title: Agents write with contracts
description: How an agent learns the rules of a site from the errors it gets while it writes.
date: 2026-09-08
tags:
  - agents
  - cms
translationGroup: agents-and-contracts
---

# Agents write with contracts

How an agent learns the rules of a site from the errors it gets while it writes. This post is part of the synthetic corpus of the tests, so its words only need to read like a post.

## Why it matters

A site that publishes often needs **fast reads** and _predictable_ writes. Read [the post about markdown as the source of truth](/en/blog/markdown-as-source-of-truth/) for the related part of the story.

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

![A diagram of the flow](/images/agents-write-with-contracts.png)
