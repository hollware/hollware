---
'@hollware/core': minor
'@hollware/vue': patch
'@hollware/react': patch
'@hollware/nuxt': patch
---

Comark 0.9.2 parses the Markdown. Braces in the middle of prose, `Use {x} here`, stay in the text instead of being taken as attributes and reported as left out; braces that end an element are still attributes, and still reported. Formatting writes such braces escaped, `\{x}`, which reads the same. Linkify is registered as Comark's own plugin, with fuzzy links off as before. Every stored revision names Comark 0.8.1, so the reparse rebuilds them with 0.9.2; the documents of the shared fixtures are the same.
