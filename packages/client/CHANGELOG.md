# @hollware/client

## 0.9.1

### Patch Changes

- Updated dependencies []:
  - @hollware/core@0.9.1

## 0.9.0

### Patch Changes

- Updated dependencies []:
  - @hollware/core@0.9.0

## 0.8.0

### Patch Changes

- Updated dependencies [[`501174a`](https://github.com/hollware/hollware/commit/501174a4b9cd7e0a5191fa587c09e39f71ff3bd7), [`eaa743d`](https://github.com/hollware/hollware/commit/eaa743d4f6a6cb7ec5977f73379e6f414f43403f), [`f2f2c3d`](https://github.com/hollware/hollware/commit/f2f2c3d6ac6123d26bc1bc0d2b668b61d42afd9d), [`d1ea96e`](https://github.com/hollware/hollware/commit/d1ea96e61df8a7b58e0a9b5e76b85abdddc78a7a), [`3f3cb16`](https://github.com/hollware/hollware/commit/3f3cb16b9779defecc14c95b6607989a3dd22367), [`286149b`](https://github.com/hollware/hollware/commit/286149b7106adb84b5ee02b0433dc780b50be6e3)]:
  - @hollware/core@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [[`e43c814`](https://github.com/hollware/hollware/commit/e43c81420272ed1a0835ec681df11ac4cc259539)]:
  - @hollware/core@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [[`30339e0`](https://github.com/hollware/hollware/commit/30339e000c290ddbceab88161be35ef071ccbe0e), [`059ecdf`](https://github.com/hollware/hollware/commit/059ecdffdd9d4394918dd594cf855898bf34b6d1)]:
  - @hollware/core@0.6.0

## 0.5.0

### Minor Changes

- [`0712311`](https://github.com/hollware/hollware/commit/071231163dbf2bb7f5e3368466c5ed0ea5a3c20c) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Full-text search (ADR-029). The operation `search` finds the published entries that hold every word of a query, in their title, tags and text, best first, with a snippet that marks the match; it is a tool over MCP, `GET /v1/search` in the read API, and `search` over RPC and in `@hollware/client`. Migration `0008_search.sql` adds the FTS5 index, kept by triggers in the step that publishes or unpublishes, and indexes what is published already. "migracion" finds "migración".

- [`310b3ab`](https://github.com/hollware/hollware/commit/310b3abbadfe303be1c90e4c5009ef99bc08c8e1) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Semantic and hybrid search (ADR-030). `search` takes a `mode`: `fulltext`, `semantic` (by meaning, in any language) or `hybrid`, the default, which merges both; the answer says which mode ran, and a Worker without semantic search answers full text. `get_entry` takes `related: true` and answers the published entries closest to the entry by meaning, in its collection and locale. Over RPC and `@hollware/client` they are the options `mode` and `related`; over the read API, `GET /v1/search?mode=` and `GET /v1/{collection}/{locale}/{slug}?related=true`.

### Patch Changes

- Updated dependencies [[`02b2fe2`](https://github.com/hollware/hollware/commit/02b2fe2afc509bb3fb6a0f0110d1002b50953e26), [`0712311`](https://github.com/hollware/hollware/commit/071231163dbf2bb7f5e3368466c5ed0ea5a3c20c), [`310b3ab`](https://github.com/hollware/hollware/commit/310b3abbadfe303be1c90e4c5009ef99bc08c8e1), [`b84107c`](https://github.com/hollware/hollware/commit/b84107c9d0dd0d60d9521c7314a030cf4ab0cc67)]:
  - @hollware/core@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [[`43333d3`](https://github.com/hollware/hollware/commit/43333d309843e464c47b20412d2d1d05738c835a), [`a7b5f26`](https://github.com/hollware/hollware/commit/a7b5f261d08bf8b58e3dc98ee0a7148de71d394b)]:
  - @hollware/core@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [[`bf0d98c`](https://github.com/hollware/hollware/commit/bf0d98cf151ddb7ae4167ffa43e92cdd2a1709ae), [`2580f76`](https://github.com/hollware/hollware/commit/2580f7658f82a534624b7343b1f1d55e121f6b19), [`30479f5`](https://github.com/hollware/hollware/commit/30479f5402b29b934ce5bc06c8f3d2af3cf1bfdf), [`777ce1d`](https://github.com/hollware/hollware/commit/777ce1dee559ffa13ad576ab2f60d485097f104b)]:
  - @hollware/core@0.3.0

## 0.2.0

### Minor Changes

- [`ac2937b`](https://github.com/hollware/hollware/commit/ac2937bafc0cf5b6f1020af96d8873e3c32d9a00) Thanks [@sergioazoc](https://github.com/sergioazoc)! - The HTTP read API at `/v1`: the four read methods of the RPC binding, over published content, for a personal token with `content:read`, with ETags (304) and an OpenAPI 3.1 document at `/v1/openapi.json`. `@hollware/client` reads a Hollware over a service binding or over HTTP with one interface, and re-exports `verifyWebhook`.

### Patch Changes

- Updated dependencies [[`705aabf`](https://github.com/hollware/hollware/commit/705aabf95c83ef7ddb2b2c0b2b633a25f03dabe4), [`24faa62`](https://github.com/hollware/hollware/commit/24faa62acd99f961885adb76fe05813df1d9adcb), [`58b2bb1`](https://github.com/hollware/hollware/commit/58b2bb135ab37f295c4043331f914ba2d3bd78f8)]:
  - @hollware/core@0.2.0

## 0.1.0

No changes in this release.

## 0.0.2

### Patch Changes

- [`d834e1e`](https://github.com/hollware/hollware/commit/d834e1e6cff6d04795842f0d847af64067f104af) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Releases now ship from the `release` branch and are published directly from CI with provenance, after the maintainer approves the `npm` environment (ADR-015). The packages themselves are unchanged.

## 0.0.1

### Patch Changes

- [`622b862`](https://github.com/hollware/hollware/commit/622b8621227246aec6425471de2b257516cea3e0) Thanks [@sergioazoc](https://github.com/sergioazoc)! - First release: the package skeletons. Nothing is usable yet; this release proves the publishing pipeline end to end.
