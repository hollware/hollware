---
title: Changing a database schema safely
description: Adding a column or a table to a live database without taking the site down.
date: 2026-09-15
tags:
  - databases
  - operations
translationGroup: schema-migrations
---

# Changing a database schema safely

A schema change runs against data that is already there, while the old code may still be serving requests.

## Forward only

Never write a down migration. If a change was wrong, a new migration fixes it. Down migrations are rarely tested and lose data when they run.

## Expand, then contract

Add the new column first, deploy code that writes both, backfill, and only then drop the old column in a later release.
