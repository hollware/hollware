---
'@hollware/core': minor
---

A site's structure can be data (ADR-033): `siteDefinitionData` describes a site, its collections with JSON Schemas, components and rules, and `compileSites` resolves definitions into the sites the server reads, frontmatter validated with `@cfworker/json-schema`. Rules come from a catalog with parameters (`CATALOG`, `describeCatalog`), which adds `contracts.fieldLength`, `contracts.fieldPattern`, `contracts.requiredToPublish` and `contracts.bannedWords`; built-in factories take an `id`. `definitionsFromConfig` moves a 0.x config into definitions, keeping every verdict's hash.
