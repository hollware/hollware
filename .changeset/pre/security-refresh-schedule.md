---
'@hollware/server': patch
---

Security: a spent OAuth refresh token is detected whatever case its request names the media type in, and a scheduled publication is cancelled when, at its time, the token or app that scheduled it was revoked or expired, the person left the site, or their role no longer publishes.
