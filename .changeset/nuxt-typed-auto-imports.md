---
'@hollware/nuxt': patch
---

The auto-imports keep their types in a site: Nuxt and Nitro name each file of the runtime without its extension, which TypeScript resolves to a `.d.ts` and never to the `.d.mts` the package shipped alone, so `useHollware(event).reader`, the composables and the components came out `any`. Every declaration of the runtime now has a `.d.ts` beside it.
