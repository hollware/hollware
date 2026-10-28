---
'@hollware/server': patch
---

The MCP SDK loads on the first request to `/mcp` of an isolate, not at every cold start: a Worker that only serves the reads of its sites evaluates about 45 KiB (gzip) less before its first answer.
