---
'@hollware/core': minor
'@hollware/server': minor
'@hollware/admin': minor
'hollware': minor
'create-hollware': minor
---

People sign in through Google, Microsoft, GitHub, any OpenID Connect provider or Cloudflare Access, with passkeys optional. `auth: { providers: [...], passkeys }` in the config lists the providers, each client secret by the name of its Worker secret; a Microsoft tenant must be one directory (`common`, `organizations` and `consumers` are refused). An account signs in by its provider and subject; its verified email links it to the person who has it, accepts an invitation sent to that address, or makes the person a member of a site whose new `access.autoProvision` lets in that address or its domain. An unverified email links nothing. The account page lists the accounts of providers and adds passkeys, and the last passkey goes when an account of a provider signs the person in. An invitation takes an address (`email` of `POST /v1/admin/invitations`, `hollware invite --email`), `hollware init --owner-email` gives the owner theirs, `hollware doctor` says which secret of a provider the local project lacks, and `npm create hollware` takes `--auth <kind>` with its credentials.
