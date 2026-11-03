---
'hollware': patch
'create-hollware': patch
---

`hollware doctor --remote` checks with wrangler that no R2 bucket of the project is open to the internet (no r2.dev URL, no custom domain), and fails when it cannot confirm it. A new project turns on Workers observability (logs).
