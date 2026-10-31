---
'@hollware/core': minor
'@hollware/server': minor
'@hollware/admin': minor
---

`admin: { path: '/' }` in the config puts the admin at the root of the Worker's origin, such as `https://admin.example.com/`, instead of `/admin/`: its pages answer at `/`, `/entries`, `/reviews`, `/images`, `/settings` and `/callback`, `/admin/…` redirects there with a 301, and its files stay under `/admin/assets/`. The admin's OAuth client is now kept by its redirect URI, so after this release each person signs in to the admin once more.
