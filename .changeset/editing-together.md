---
'@hollware/core': minor
'@hollware/server': minor
'@hollware/admin': minor
---

Two people, or a person and an agent, can work on one entry without losing each other's changes. The admin beats `POST /v1/admin/presence` every 15 seconds while an entry is open (and when its tab comes back), which keeps who has it open (migration `0040_presence.sql`, rows of a person kept 45 seconds, forgotten after two minutes or when they leave) and answers the version and author of its latest revision. The editor shows the others as avatars; when someone saves a newer version, it loads it when nothing is unsaved, and otherwise offers to combine. A save that meets a newer version, by a person or an agent, combines the two by lines against the version that was opened: what does not clash joins on its own, and a clash opens both sides to keep one's own or theirs there.
