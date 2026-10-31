---
'@hollware/nuxt': patch
---

`useHollware(event).reader` answers `search` and `listRedirects` over a service binding: the methods of an RPC stub live on its prototype, and the reader now wraps each one instead of spreading the stub.
