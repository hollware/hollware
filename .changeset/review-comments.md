---
'@hollware/core': minor
'@hollware/server': minor
'@hollware/admin': minor
---

Comments on reviews. The new tool `comment_review` (`content:write`) adds a comment to a pending review, in the caller's name and with the name its client gave, for the person who decides and for the author; it decides nothing. `list_reviews` answers each review with its comments, oldest first, and the admin's review screen shows them and takes new ones. Migration `0010_review_comments.sql` adds the table.
