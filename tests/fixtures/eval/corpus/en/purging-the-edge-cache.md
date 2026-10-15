---
title: Purging the edge cache
description: When a cached page goes stale, and how a publish clears it everywhere at once.
date: 2026-09-15
tags:
  - cloudflare
  - performance
translationGroup: edge-cache-purge
---

# Purging the edge cache

A page kept at the edge answers fast, until the content behind it changes and readers keep getting the old copy.

## Time to live

Each cached response carries a lifetime. A long lifetime saves work at the origin; a short one shows changes sooner. Most sites pick minutes for HTML and a year for hashed assets.

## Purging by tag

Tag each response with the entry it shows. When the entry is published again, purge that tag, and every data center drops the stale page within seconds.
