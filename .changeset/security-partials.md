---
'@hollware/core': minor
'@hollware/server': patch
'@hollware/admin': patch
'@hollware/client': minor
'hollware': patch
---

Security fixes from the threat model:

- `verifyWebhook` takes `isNew(eventId)`. Given it, a webhook replayed within the tolerance is refused, by the id of its signed body (T-67).
- The renderer reads a URL bound to the frontmatter (`:href="frontmatter.url"`) under its own rules instead of leaving it to `@comark/html`, which let a `data:image/svg+xml` link through (T-59).
- An invitation link carries its secret in the fragment (`/setup#invitation=…`), which no request log holds. Older links still work (T-55).
- Sign-in requires user verification explicitly. A counter that went back, or an assertion from another origin, is a refused passkey, not a server error (T-52, T-53).
- The admin shows the preview of a draft in a sandboxed frame. Nothing it renders can run, reach the admin or draw over it (T-60).
