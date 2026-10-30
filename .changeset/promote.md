---
'@hollware/core': minor
'@hollware/server': minor
'hollware': minor
---

`list_entries` takes `changedSince`, an ISO 8601 time: only the entries changed at or after it, in the same order. `hollware promote --from <url> --to <url>` copies what one Hollware publishes to another (staging to production) as drafts there, in one grouped review that also unpublishes what the source no longer publishes; `--publish` publishes instead. A state file (`.hollware/promote-<from>-<to>.json`) keeps where it stopped, so the next run reads only what changed; an entry changed in the destination since the last promotion is still promoted, with a comment on it in the review that shows the difference. The images the entries show are copied when the destination lacks them. `--dry-run` prints the plan and writes nothing.
