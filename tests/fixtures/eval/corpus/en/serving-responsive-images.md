---
title: Serving responsive images
description: Sending a phone a small picture and a wide screen a large one, in a modern format.
date: 2026-09-15
tags:
  - performance
  - images
translationGroup: responsive-images
---

# Serving responsive images

An image sized for a desktop wastes bandwidth on a phone and slows the first paint.

## srcset and sizes

List the widths the image comes in and tell the browser how wide it will be drawn. The browser picks the smallest file that looks sharp.

## Formats

AVIF and WebP weigh far less than JPEG at the same quality. Serve them to browsers that ask for them, and keep JPEG as the fallback.
