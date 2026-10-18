---
'@hollware/server': patch
---

Security: a spent OAuth refresh token is detected whatever case its request names the media type in (T-34), and a scheduled publication is cancelled when, at its time, the token or app that scheduled it was revoked or expired, the person left the site, or their role no longer publishes (T-108).
