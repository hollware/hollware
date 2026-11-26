---
'@hollware/core': minor
'@hollware/admin': minor
---

The rule `reserved-slugs` of the catalog, and `contracts.reservedSlugs` in a config, keep an entry off the slugs a collection may not take, such as the paths a site serves from its own code: `{ "rule": "reserved-slugs", "params": { "slugs": ["blog", "demo"], "reason": "the site serves them" } }`. A draft with one of them is saved with the error, and it cannot be published until its slug changes. The admin shows the error in Spanish too.
