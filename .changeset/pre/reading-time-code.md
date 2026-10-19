---
'@hollware/core': minor
'@hollware/server': minor
---

The reading time counts the code a reader reads: the pipeline counts the words of code blocks apart (`codeWords`), each revision keeps them (migration `0022`, filled for older revisions by the reparse of the cron, as `PIPELINE_VERSION` 3 marks them), and `readingTime` of `automaticFields` is the words and the words of code at 200 a minute. `wordCount` stays the words of the text.
