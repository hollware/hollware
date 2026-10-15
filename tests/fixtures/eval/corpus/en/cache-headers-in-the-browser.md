---
title: Cache headers in the browser
description: How Cache-Control and ETag decide what a browser keeps on the reader's own device.
date: 2026-09-15
tags:
  - performance
  - http
translationGroup: browser-cache
---

# Cache headers in the browser

Before any edge, the browser has a cache of its own, ruled by the headers of each answer.

## Cache-Control

max-age says how many seconds a copy stays fresh on the device. no-store keeps nothing, which is right for private pages.

## Revalidation

With an ETag, the browser asks whether its copy still holds, and a 304 answers yes without sending the body again.
