---
title: Edge caching, from the first request to the purge
description: "A long synthetic post that the Markdown benchmark parses: 2,027 words of prose with headings, lists, links, code and a component."
date: 2026-10-10
tags:
  - cloudflare
  - cms
translationGroup: long-post
---

# Edge caching, from the first request to the purge

An edge node writes a fresh copy before the deadline. A revision clears the tag list after every publish. The purge checks a short answer after every publish. The writer stores the next version within a few milliseconds. A revision clears the published version within a few milliseconds. The writer stores the tag list for every locale. The origin clears a short answer for every locale.

## Part 1: what the edge sees

The purge writes the tag list after every publish. A draft clears a short answer within a few milliseconds. A reader keeps a short answer until the next purge. The writer answers _a fresh copy_ without a second request. The purge reads the next version within a few milliseconds. The origin stores the next version within a few milliseconds. An edge node records an old response in the nearest region. Read [the part about the purge](/en/blog/edge-caching-basics/) next.

An edge node writes every revision for every locale. The cache serves the published version within a few milliseconds. The verdict keeps the next version within a few milliseconds. The agent checks a short answer until the next purge. The cache checks the page before the deadline. A revision clears a short answer without a second request.

## Part 2: what the reader sees

The verdict reads the translation pair until the next purge. A reader reads the translation pair after every publish. A draft stores every revision before the deadline. A draft stores the next version after every publish. A reader clears every revision within a few milliseconds. An edge node stores the translation pair in the nearest region. The origin stores the translation pair after every publish. The writer records the tag list without a second request. Read [the part about the headers](/en/blog/edge-caching-basics/) next.

Each request returns the next version in the nearest region. A revision answers the page for every locale. A draft checks the published version after every publish. The origin reads the next version without a second request. A reader stores a short answer for every locale. The agent reads the published version without a second request.

## Part 3: what the writer sees

The writer returns _a fresh copy_ within a few milliseconds. A reader stores the tag list within a few milliseconds. **The cache** writes the page after every publish. The cache reads the next version for every locale. The writer records the published version in the nearest region. An edge node serves an old response in the nearest region. The writer serves every revision in the nearest region. The verdict records a short answer for every locale. Read [the part about the tags](/en/blog/edge-caching-basics/) next.

The origin serves the next version after every publish. A revision clears the tag list in the nearest region. The site checks the page after every publish. The cache records the translation pair when the version matches. A reader checks the published version within a few milliseconds. A reader writes every revision for every locale.

- An edge node clears every revision within a few milliseconds.

## Part 4: what the origin sees

The origin writes the next version after every publish. The site answers the headers until the next purge. An edge node reads every revision before the deadline. A draft checks the headers until the next purge. A draft returns _a fresh copy_ for every locale. The site records the published version within a few milliseconds. A reader returns the next version until the next purge. **The cache** checks the tag list without a second request. Read [the part about the origin](/en/blog/edge-caching-basics/) next.

A draft keeps every revision in the nearest region. A revision checks the next version for every locale. The writer serves the published version before the deadline. The purge checks the next version without a second request. The writer reads the translation pair without a second request. The origin checks the headers before the deadline.

```ts
const response = await cache.match(request)
if (response) return response
```

## Part 5: what the edge sees

**The cache** keeps the headers within a few milliseconds. The verdict checks the published version until the next purge. The origin writes a short answer for every locale. Each request checks the published version until the next purge. Each request keeps _a fresh copy_ when the version matches. The writer writes the translation pair until the next purge. The cache clears the headers in the nearest region. The verdict returns the next version until the next purge. Read [the part about the purge](/en/blog/edge-caching-basics/) next.

A revision reads a short answer until the next purge. A draft stores a short answer when the version matches. The agent serves a fresh copy before the deadline. An edge node serves the translation pair until the next purge. An edge node answers every revision until the next purge. A draft keeps a fresh copy after every publish.

::callout{type="info"}
The writer records the published version in the nearest region. The writer stores the tag list within a few milliseconds.
::

## Part 6: what the reader sees

Each request answers an old response in the nearest region. Each request reads the tag list without a second request. **The cache** checks the translation pair when the version matches. A revision records _a fresh copy_ when the version matches. The agent records the page in the nearest region. The origin keeps a fresh copy within a few milliseconds. The verdict answers the headers after every publish. The verdict returns the translation pair within a few milliseconds. Read [the part about the headers](/en/blog/edge-caching-basics/) next.

A draft records a fresh copy when the version matches. The agent keeps the tag list before the deadline. The site writes the headers when the version matches. The site writes a short answer after every publish. A draft records an old response for every locale. A draft checks an old response in the nearest region.

- A revision serves the page until the next purge.

> The site answers the translation pair for every locale. The agent reads the tag list in the nearest region.

## Part 7: what the writer sees

A draft reads a short answer when the version matches. **The cache** answers the page after every publish. The origin answers the tag list for every locale. A reader records the page in the nearest region. A revision records the translation pair until the next purge. The site writes the tag list within a few milliseconds. The verdict records the next version before the deadline. A draft records the next version for every locale. Read [the part about the tags](/en/blog/edge-caching-basics/) next.

The verdict keeps an old response before the deadline. The purge records a fresh copy within a few milliseconds. The writer answers the headers when the version matches. The origin stores the headers for every locale. A draft stores an old response within a few milliseconds. A reader clears every revision before the deadline. Each request stores the page in the nearest region.

## Part 8: what the origin sees

The purge clears a short answer in the nearest region. The verdict stores a short answer in the nearest region. The agent checks the tag list when the version matches. The verdict reads an old response without a second request. **The cache** writes the translation pair after every publish. The purge checks the headers without a second request. The writer checks the headers when the version matches. A reader keeps the published version for every locale. Read [the part about the origin](/en/blog/edge-caching-basics/) next.

An edge node keeps the headers for every locale. Each request serves the page until the next purge. An edge node keeps an old response after every publish. The purge reads the published version for every locale. Each request answers an old response when the version matches. A draft reads the page without a second request.

```ts
const response = await cache.match(request)
if (response) return response
```

## Part 9: what the edge sees

An edge node clears the translation pair until the next purge. A reader writes the next version without a second request. Each request stores the next version in the nearest region. The site records the headers within a few milliseconds. The purge clears the next version in the nearest region. An edge node reads the headers until the next purge. The purge returns the page when the version matches. **The cache** serves _a fresh copy_ within a few milliseconds. Read [the part about the purge](/en/blog/edge-caching-basics/) next.

A revision returns the headers in the nearest region. The site records the headers within a few milliseconds. The cache reads an old response when the version matches. An edge node checks a short answer within a few milliseconds. The site answers a fresh copy when the version matches. A draft writes a short answer for every locale.

- Each request stores a short answer until the next purge.

## Part 10: what the reader sees

A revision stores the tag list before the deadline. The writer returns the next version before the deadline. A reader returns the tag list when the version matches. The site returns an old response when the version matches. The origin checks the published version for every locale. A draft keeps every revision within a few milliseconds. The origin writes a short answer for every locale. A reader serves an old response without a second request. Read [the part about the headers](/en/blog/edge-caching-basics/) next.

The cache writes the tag list without a second request. The site records a short answer in the nearest region. A draft answers an old response without a second request. The purge answers an old response before the deadline. A draft records the translation pair for every locale. The writer answers the page within a few milliseconds.

::callout{type="info"}
The verdict answers a fresh copy before the deadline. The origin answers the published version after every publish. The purge clears the next version in the nearest region.
::

## Part 11: what the writer sees

A revision keeps every revision when the version matches. A revision returns an old response in the nearest region. An edge node stores the translation pair in the nearest region. An edge node writes the published version for every locale. The verdict records the next version in the nearest region. The agent checks the published version when the version matches. Each request checks a short answer when the version matches. Read [the part about the tags](/en/blog/edge-caching-basics/) next.

The writer returns a fresh copy for every locale. The site reads a short answer after every publish. A draft reads every revision after every publish. The site returns the tag list in the nearest region. The writer checks a fresh copy in the nearest region. The agent serves the tag list for every locale.

## Part 12: what the origin sees

A reader answers a short answer after every publish. The agent keeps an old response within a few milliseconds. A revision returns the headers within a few milliseconds. The agent writes the page in the nearest region. Each request records the published version in the nearest region. The writer records the published version until the next purge. Each request answers the tag list when the version matches. The agent checks the headers until the next purge. Read [the part about the origin](/en/blog/edge-caching-basics/) next.

The writer checks the published version in the nearest region. The cache serves a fresh copy in the nearest region. The writer answers the page before the deadline. The verdict stores the published version without a second request. The verdict answers an old response without a second request. The writer writes the tag list for every locale.

- The verdict keeps every revision for every locale.

```ts
const response = await cache.match(request)
if (response) return response
```

> The cache clears every revision without a second request. The origin writes a short answer without a second request.

## Closing

A revision returns the page when the version matches. The cache answers the next version for every locale. An edge node checks every revision without a second request. A draft returns a fresh copy before the deadline. The verdict checks an old response for every locale. The purge returns the translation pair without a second request. The cache answers the headers when the version matches. Each request clears the translation pair without a second request. The cache reads the next version when the version matches. The purge writes.
