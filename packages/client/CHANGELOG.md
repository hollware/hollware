# @hollware/client

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
