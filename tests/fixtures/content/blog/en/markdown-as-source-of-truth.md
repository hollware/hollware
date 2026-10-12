---
title: Markdown as the source of truth
description: Why the Markdown file is what the CMS keeps, and everything else is derived from it.
date: 2026-09-15
tags:
  - markdown
translationGroup: markdown-source
---

# Markdown as the source of truth

Why the Markdown file is what the CMS keeps, and everything else is derived from it. This post is part of the synthetic corpus of the tests, so its words only need to read like a post.

## Why it matters

A site that publishes often needs **fast reads** and _predictable_ writes. Read [the post about one deployment, many sites](/en/blog/one-deployment-many-sites/) for the related part of the story.

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

![A diagram of the flow](/images/markdown-as-source-of-truth.png)
