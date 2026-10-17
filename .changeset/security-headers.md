---
'@hollware/server': patch
'@hollware/admin': patch
---

Security headers that the OWASP ZAP baseline of staging asked for: every answer of the Worker has `X-Content-Type-Options: nosniff`, and `Strict-Transport-Security` when the public URL is https. Its pages add `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy` of `same-origin` and a `Permissions-Policy` that asks for no device. The sign-in, setup and consent pages allow their own stylesheet by its hash instead of `'unsafe-inline'`, and the admin's built files get the same headers through `_headers`.
