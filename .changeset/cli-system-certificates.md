---
'hollware': patch
---

The CLI trusts the certificates of the system besides Node's, so `import`, `export`, `promote` and every command with `--url` work behind a proxy that inspects TLS, such as Cloudflare WARP or Gateway, instead of failing with `SELF_SIGNED_CERT_IN_CHAIN`.
