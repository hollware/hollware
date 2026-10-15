---
title: Dates across time zones
description: Storing a moment once and showing it right to a reader in Santiago and another in Tokyo.
date: 2026-09-15
tags:
  - i18n
  - backend
translationGroup: time-zones
---

# Dates across time zones

A date typed as local time means a different moment for every reader who sees it.

## Store UTC

Keep every instant in UTC with its offset, in ISO 8601. Convert to the reader's zone only when you show it.

## Calendar dates

A birthday or a publication day is a date, not an instant. Store it without a time, or it moves a day for half the world.
