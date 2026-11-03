---
'@hollware/server': patch
---

Uploads in parts: one request at a time finishes an upload (another answers 409 and touches nothing in R2), one person keeps at most ten open in a site (429 past that), the cron also aborts an upload whose finish never ended, and anonymizing a person hands their open uploads to the cron instead of leaving their parts in R2 (migration `0035_upload_claims`).
