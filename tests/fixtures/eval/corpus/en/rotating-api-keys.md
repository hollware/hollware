---
title: Rotating API keys
description: Replacing a secret key on a schedule without breaking the clients that use it.
date: 2026-09-15
tags:
  - security
  - operations
translationGroup: api-keys
---

# Rotating API keys

A key that never changes stays valid for whoever copied it, forever.

## Two keys at once

Issue the new key, let clients move to it, and revoke the old one only when nothing uses it anymore.

## Where keys live

Keep keys in a secret store, never in the repository. A key in git history is a leaked key.
