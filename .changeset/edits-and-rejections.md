---
'@hollware/core': minor
'@hollware/server': minor
'@hollware/admin': minor
---

What people can change, and a way to say no:

- `reject_review` closes a pending review as `rejected`, with the reason: unlike `request_changes`, it does not ask for another try. The admin's Reviews page has Reject beside Ask for changes. Migration `0021` lets a review be rejected.
- `update_asset` changes the alt of an image (the admin's Images page edits it). An image of the site written with no alt of its own takes its asset's when a site reads it, and `images-have-alt` no longer flags it.
- A person changes their own name, and the labels of their passkeys, under Account; nobody else can change them.
