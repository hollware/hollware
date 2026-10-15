---
title: Limiting request rates
description: Slowing down a client that sends too many requests before it takes the service down.
date: 2026-09-15
tags:
  - operations
  - security
translationGroup: rate-limiting
---

# Limiting request rates

One script in a loop can use up the capacity meant for thousands of readers.

## Token bucket

Each client gets a bucket that refills at a steady pace. A request takes a token; an empty bucket means wait, and the answer is 429.

## Which key

Limit by account when there is one, and by address otherwise. Tell the client when to try again with Retry-After.
