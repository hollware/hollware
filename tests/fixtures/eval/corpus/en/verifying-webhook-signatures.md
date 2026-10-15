---
title: Verifying webhook signatures
description: Proving that a notification really came from the service that claims to have sent it.
date: 2026-09-15
tags:
  - security
  - integrations
translationGroup: webhook-signatures
---

# Verifying webhook signatures

A webhook is a request any stranger could send to your endpoint, so the body alone proves nothing.

## HMAC

The sender signs the timestamp and the body with a shared secret. The receiver computes the same signature and compares the two in constant time.

## Replays

Refuse a signature older than five minutes, and remember the ids already handled, so the same event never counts twice.
