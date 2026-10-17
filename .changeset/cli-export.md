---
'hollware': minor
---

`hollware export <directory>` writes the entries of a site over MCP as `<collection>/<locale>/<slug>.md`, byte for byte as Hollware keeps them, so that `hollware import` takes them back unchanged, with `--published`, `--collection`, `--locale`, `--site` and `--dry-run`.
