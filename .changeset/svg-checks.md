---
'@hollware/core': patch
'@hollware/server': patch
---

An SVG is refused when it holds a character reference or an entity beyond the five of XML, a backslash, or an animation of a link: `&#106;avascript:` in a `<set>`, or `@\69mport` in a style, got past the checks that read the text as written.
