---
'@hollware/server': minor
'create-hollware': minor
---

The routes anyone may call without a token (sign-in and passkeys, OAuth's token and registration endpoints, the beacon) are rate limited per address when the Worker has a Workers Rate Limiting binding, `HOLLWARE_RATE_LIMIT`, which new projects get (60 requests a minute): past it they answer 429 with Retry-After. And the cron trigger drops the expired sessions and the sign-in challenges nobody took, which anyone could make pile up a row a request.
