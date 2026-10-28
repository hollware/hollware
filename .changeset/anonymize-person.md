---
'@hollware/server': minor
'@hollware/core': minor
'@hollware/admin': minor
---

An owner can anonymize a person removed from the site, from Former members in People (`POST /v1/admin/people/anonymize`; `GET /v1/admin/people` lists them as `former`). What they wrote stays, and every revision, publication, review, comment, schedule, change of the structure, image and line of the activity log of the site names `FORMER_PERSON` of `@hollware/core` instead of them, without the tokens, IP hashes and client names it held; the name leaves the review events, their tokens and invitations of the site go, and so do the apps they allowed for it. Once no site keeps them, the person goes from the deployment with their passkeys and sessions. The append-only triggers allow those changes only while the anonymization is open, and nothing else; the activity log records `member.anonymize`, naming no one.
